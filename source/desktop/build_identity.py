"""Windows package identity shared by the installer and its running update client."""
import argparse
from pathlib import Path
import re
import uuid

WINDOWS_VERSION = '7.0.4'


def guid(name, instance=None):
    prefix = 'lychee-desktop/' + (f'qa/{uuid.UUID(instance)}/' if instance else '')
    return '{' + str(uuid.uuid5(uuid.NAMESPACE_URL, prefix + name)).upper() + '}'


def write_identity(out, version, instance=None):
    if not re.fullmatch(r'(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)', version):
        raise ValueError('Expected a three-part release version')
    if any(n > limit for n, limit in zip(map(int,version.split('.')), (255,255,65535))):
        raise ValueError('Version exceeds Windows Installer limits')
    suffix = ' QA ' + str(uuid.UUID(instance)) if instance else ''
    out.write_text(f'''using System.Reflection;
[assembly: AssemblyFileVersion("{version}.0")]
[assembly: AssemblyCompany("Lychee / " + WindowsInstallationIdentity.UpgradeCode)]
internal static class WindowsInstallationIdentity {{
    public const string ComponentId = "{guid('component/main', instance)}";
    public const string UpgradeCode = "{guid('upgrade', instance)}";
    public const string ProductName = "Lychee Desktop{suffix}";
    public const string Version = "{version}";
    public static readonly bool IsTestBuild = {str(bool(instance)).lower()};
}}
''',encoding='utf8')


if __name__ == '__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('out',type=Path)
    parser.add_argument('--version',default=WINDOWS_VERSION)
    parser.add_argument('--qa-instance')
    args=parser.parse_args()
    write_identity(args.out,args.version,args.qa_instance)
