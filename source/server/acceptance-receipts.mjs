import { createHash, createHmac, randomBytes } from 'node:crypto';

const runs = 'mc_acceptance_runs_v1';
const claims = 'mc_acceptance_claims_v1';
const services = ['chat', 'image', 'soup'];
const uuid = value => typeof value === 'string' && value.length === 36 &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
const fail = code => { throw Error('acceptance-receipt-' + code); };
const query = (sql, ...args) => ({sql, args});
const blank = () => ({
  preparation:{state:'unprepared',gardenId:null,ownerAccountId:null},
  phase:'unattempted',
  attempts:{chat:'unattempted',image:'unattempted',soup:'unattempted'},
});

// This module has no startup side effects. The caller owns the libSQL client.
// Only the explicit run mode may initialize or change the receipt tables.
export async function createAcceptanceReceipts(client, {seed, mode='status'}={}) {
  if (!['run','status'].includes(mode)) fail('invalid-mode');
  if (typeof seed!=='string' || seed.length<32 || /\s/.test(seed) || new Set(seed).size<8) fail('invalid-seed');
  const run = createHmac('sha256',seed).update('lychee/server-acceptance/run/v1','utf8').digest('hex');
  const worker = createHash('sha256').update(randomBytes(32)).digest('hex');
  const writable = () => { if(mode!=='run')fail('read-only'); };
  const privateGarden = garden => { if(!uuid(garden))fail('invalid-private-garden'); };
  const service = kind => { if(!services.includes(kind))fail('invalid-service'); };
  const outcome = state => { if(!['succeeded','uncertain'].includes(state))fail('invalid-outcome'); };
  if (mode==='run') {
    await client.batch([
      `CREATE TABLE IF NOT EXISTS ${runs}(
        run TEXT PRIMARY KEY NOT NULL, prep TEXT NOT NULL CHECK(prep IN ('claimed','uncertain','ready')),
        claimant TEXT NOT NULL, garden TEXT UNIQUE, owner TEXT, created INTEGER NOT NULL, updated INTEGER NOT NULL,
        CHECK((prep='ready' AND garden IS NOT NULL AND garden<>'legacy' AND owner IS NOT NULL)
          OR (prep<>'ready' AND garden IS NULL AND owner IS NULL)), UNIQUE(run,garden))`,
      `CREATE TABLE IF NOT EXISTS ${claims}(
        garden TEXT NOT NULL CHECK(garden<>'legacy'), kind TEXT NOT NULL CHECK(kind IN ('phase','chat','image','soup')),
        run TEXT NOT NULL, claimant TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('claimed','succeeded','uncertain')),
        created INTEGER NOT NULL, updated INTEGER NOT NULL, PRIMARY KEY(garden,kind), UNIQUE(run,kind),
        FOREIGN KEY(run,garden) REFERENCES ${runs}(run,garden))`,
    ],'write');
  }

  async function status() {
    const tx=await client.transaction('read');
    try {
      const receipt=blank();
      const tables=(await tx.execute(query("SELECT name FROM sqlite_master WHERE type='table' AND name IN (?,?)",runs,claims))).rows;
      if (tables.length===1) fail('incomplete-schema');
      if (tables.length===2) {
        const saved=(await tx.execute(query(`SELECT prep,garden,owner FROM ${runs} WHERE run=?`,run))).rows[0];
        if(saved){
          receipt.preparation={state:saved.prep,gardenId:saved.garden,ownerAccountId:saved.owner};
          const rows=(await tx.execute(query(`SELECT kind,state FROM ${claims} WHERE run=?`,run))).rows;
          for(const row of rows){
            if(row.kind==='phase')receipt.phase=row.state;
            else if(services.includes(row.kind))receipt.attempts[row.kind]=row.state;
          }
        }
      }
      await tx.commit();
      return receipt;
    } catch(error) {
      try { await tx.rollback(); } catch { /* Keep the original receipt error. */ }
      throw error;
    } finally { tx.close(); }
  }
  async function claimPreparation() {
    writable();
    const now=Date.now();
    const result=await client.execute(query(`INSERT INTO ${runs}(run,prep,claimant,created,updated)
      VALUES(?,'claimed',?,?,?) ON CONFLICT(run) DO NOTHING`,run,worker,now,now));
    const {preparation}=await status();
    return {acquired:result.rowsAffected===1,...preparation};
  }
  async function finishPreparation(gardenId,ownerAccountId) {
    writable(); privateGarden(gardenId);
    if(!uuid(ownerAccountId))fail('invalid-owner');
    const updated=await client.execute(query(`UPDATE ${runs} SET prep='ready',garden=?,owner=?,updated=?
      WHERE run=? AND claimant=? AND (prep='claimed' OR (prep='ready' AND garden=? AND owner=?))
      AND EXISTS(SELECT 1 FROM mc_members m JOIN mc_gardens g ON m.garden=g.id
        WHERE g.id=? AND m.account=? AND m.role='owner')
      AND NOT EXISTS(SELECT 1 FROM ${runs} other WHERE other.garden=? AND other.run<>?)`,
      gardenId,ownerAccountId,Date.now(),run,worker,gardenId,ownerAccountId,gardenId,ownerAccountId,gardenId,run));
    if(updated.rowsAffected!==1)fail('preparation-unconfirmed');
  }
  async function markPreparationUncertain() {
    writable();
    const updated=await client.execute(query(`UPDATE ${runs} SET prep='uncertain',updated=?
      WHERE run=? AND claimant=? AND prep IN ('claimed','uncertain')`,Date.now(),run,worker));
    if(updated.rowsAffected!==1)fail('preparation-not-owned');
  }
  async function claim(kind,gardenId) {
    writable(); privateGarden(gardenId);
    const now=Date.now(), phase=kind==='phase';
    const phaseGuard=phase ? '' : `AND EXISTS(SELECT 1 FROM ${claims} phase WHERE phase.garden=r.garden
      AND phase.run=r.run AND phase.kind='phase' AND phase.claimant=? AND phase.state='claimed')`;
    const tx=await client.transaction('write');
    try {
      const inserted=await tx.execute(query(`INSERT INTO ${claims}(garden,kind,run,claimant,state,created,updated)
        SELECT r.garden,?,r.run,?,'claimed',?,? FROM ${runs} r WHERE r.run=? AND r.garden=? AND r.prep='ready'
        ${phaseGuard} ON CONFLICT(garden,kind) DO NOTHING`,
        kind,worker,now,now,run,gardenId,...(phase?[]:[worker])));
      const previous=(await tx.execute(query(`SELECT state FROM ${claims} WHERE run=? AND garden=? AND kind=?`,run,gardenId,kind))).rows[0];
      if(!previous)fail(phase?'garden-not-prepared':'phase-not-owned');
      await tx.commit();
      return {acquired:inserted.rowsAffected===1,state:previous.state};
    } catch(error) {
      try { await tx.rollback(); } catch { /* A lost claim acknowledgement must not authorize a call. */ }
      throw error;
    } finally { tx.close(); }
  }
  async function finish(kind,gardenId,state) {
    writable(); privateGarden(gardenId); outcome(state);
    const requireSuccess=kind==='phase' && state==='succeeded' ?
      `AND 3=(SELECT count(*) FROM ${claims} item WHERE item.garden=? AND item.run=?
        AND item.kind IN ('chat','image','soup') AND item.state='succeeded')` : '';
    const updated=await client.execute(query(`UPDATE ${claims} SET state=?,updated=?
      WHERE run=? AND garden=? AND kind=? AND claimant=? AND state IN ('claimed',?)
      ${requireSuccess}`,state,Date.now(),run,gardenId,kind,worker,state,...(requireSuccess?[gardenId,run]:[])));
    if(updated.rowsAffected!==1)fail('claim-unconfirmed');
  }
  return {
    status,claimPreparation,finishPreparation,markPreparationUncertain,
    claimPhase:garden=>claim('phase',garden),
    finishPhase:(garden,state)=>finish('phase',garden,state),
    claimAttempt(kind,garden){service(kind);return claim(kind,garden);},
    finishAttempt(kind,garden,state){service(kind);return finish(kind,garden,state);},
  };
}
