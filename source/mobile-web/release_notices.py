"""One mobile-web release list supplies the visible version and both notice views."""
import ast
import json
import re
import subprocess
from datetime import date
from pathlib import Path

from chat_build import replace


def releases():
    rows = json.loads(Path(__file__).with_name("releases.json").read_text(encoding="utf8"))
    versions = []
    for row in rows:
        version = row["version"]
        if not re.fullmatch(r"(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)", version):
            raise ValueError("Invalid mobile web version: " + version)
        date.fromisoformat(row["date"])
        if not row["title"].strip() or not row["items"] or not all(
            len(pair) == 2 and all(isinstance(s, str) and s.strip() for s in pair) for pair in row["items"]
        ):
            raise ValueError("A mobile web release needs a title and announcement: " + version)
        versions.append(tuple(map(int, version.split("."))))
    if not versions or versions != sorted(set(versions), reverse=True):
        raise ValueError("Add each new mobile web version above the unchanged release history")
    return rows


def check_previous(root, ref):
    rows = releases()
    path = "source/mobile-web/releases.json"
    tree = subprocess.check_output(["git", "ls-tree", "--name-only", ref, "--", path], cwd=root)
    if tree.strip():
        old = json.loads(subprocess.check_output(["git", "show", f"{ref}:{path}"], cwd=root))
    else:
        # The first independent mobile version (7.0.1) stored its note in the build script.
        previous = subprocess.check_output(["git", "show", f"{ref}:source/mobile-web/build.py"], cwd=root)
        record = next(node.value for node in ast.parse(previous).body if isinstance(node, ast.Assign)
                      and any(isinstance(t, ast.Name) and t.id == "RELEASE" for t in node.targets))
        old = [{k: v for k, v in ast.literal_eval(record).items() if k not in ("audience", "required")}]
    if len(rows) <= len(old) or rows[-len(old):] != old:
        raise ValueError("Add a newer version and announcement; retain every published entry")
    print(f"Mobile web release {old[0]['version']} -> {rows[0]['version']}")


def phone_history(text, rows):
    history = ",".join(json.dumps(dict(row, audience="phone", required=False), ensure_ascii=False) for row in rows)
    return replace(text, 'zf=[{"version":', 'zf=window.LycheePhoneReleases=[' + history + ',{"version":')


def workspace_gate(text):
    path = "'/api/v640/workspace'"
    if text.count(path) != 2:
        raise ValueError("Mobile workspace requests changed")
    text = text.replace(path, "'/api/v640/workspace?client=mobile-web'")
    text = replace(text, "state.notices.filter(n => !n.read)",
                   "state.notices.filter(n => !n.read && n.id === 'mobile-web-'+document.body.dataset.clientBuild)")
    return replace(text, "    if(!required)actions(box,", """    if(!required){
      const known=new Set(state.notices.map(n=>n.id));
      for(const r of window.LycheePhoneReleases || []){
        if(r.audience!=='phone'||known.has('mobile-web-'+r.version))continue;
        const row=el('article',null,'ga-notice');
        const prefix=Number(r.version.split('.')[0])>=8?'V':'';
        row.append(el('h2','荔枝 '+prefix+r.version+' · '+r.title));
        for(const [title,body] of r.items)row.append(el('p',title+'：'+body));
        row.append(el('small','历史公告'));box.append(row);
      }
    }
    if(!required)actions(box,""")


def account_catalog(text, rows):
    records = [{"id": "mobile-web-" + row["version"], "title": "荔枝 " + ("V" if int(row["version"].split(".")[0])>=8 else "") + row["version"] + " · " + row["title"],
                "body": "\n".join(title + "：" + body for title, body in row["items"])} for row in rows]
    return replace(text, "export const mobileNotices = [];", "export const mobileNotices = " +
                   json.dumps(records, ensure_ascii=False) + ";")
