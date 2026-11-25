import {createTursoClient} from './turso-client.mjs';

// Identity and membership were established by the prior, explicit migration.
// An existing cookie identifies the same account, so no sessions need replacing.
export async function grantLegacyManagers(client) {
  const tx=await client.transaction('write');
  try {
    const marker=await tx.execute('SELECT ready FROM mc_v640_install WHERE id=1');
    if(Number(marker.rows[0]?.ready)!==1)throw Error('Original account migration is not ready.');
    const {rows}=await tx.execute(`SELECT l.slot AS source_slot, c.slot AS verified_slot, m.slot AS member_slot, m.role
      FROM mc_legacy_slots l
      LEFT JOIN mc_accounts a ON a.id=l.account
      LEFT JOIN camp_accounts c ON c.slot=l.slot AND c.username=a.username COLLATE BINARY
        AND c.salt=a.salt AND c.verifier=a.verifier AND a.iterations=100000
      LEFT JOIN mc_members m ON m.account=a.id AND m.garden='legacy'
      ORDER BY l.slot`);
    if(rows.length!==3||!rows.every((row,i)=>
      Number(row.source_slot)===i+1 && Number(row.verified_slot)===i+1 && Number(row.member_slot)===i+1 &&
      ['owner','member'].includes(row.role)))throw Error('Expected three mapped original members.');
    const previous=rows.filter(row=>row.role==='owner').length;
    const owners=await tx.execute("SELECT COUNT(*) AS n FROM mc_members WHERE garden='legacy' AND role='owner'");
    if(Number(owners.rows[0].n)!==previous)throw Error('Unexpected additional legacy manager.');
    const changed=3-previous;
    if(changed){
      const result=await tx.execute(`UPDATE mc_members SET role='owner'
        WHERE garden='legacy' AND role='member' AND EXISTS (
          SELECT 1 FROM mc_legacy_slots l WHERE l.slot IN (1,2,3)
          AND l.slot=mc_members.slot AND l.account=mc_members.account)`);
      if(result.rowsAffected!==changed)throw Error('Incomplete legacy manager upgrade.');
    }
    await tx.commit();
    return {status:changed?'applied':'already-applied',mapped:3,managers:3,changed};
  }catch(error){
    try{await tx.rollback();}catch{}
    throw error;
  }finally{tx.close();}
}

export async function runLegacyManagers({mode,env=process.env,legacyDir}={}){
  if(mode===undefined||mode==='')return {status:'skipped'};
  if(mode!=='apply')throw Error('Unsupported legacy manager operation.');
  const client=await createTursoClient({url:env.TURSO_DATABASE_URL,authToken:env.TURSO_AUTH_TOKEN,legacyDir});
  try{
    const result=await grantLegacyManagers(client);
    console.info('Lychee legacy managers',JSON.stringify(result));
    return result;
  }finally{client.close();}
}
