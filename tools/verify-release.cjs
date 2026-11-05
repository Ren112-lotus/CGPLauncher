const fs = require('node:fs/promises');
const path = require('node:path');
const {createHash} = require('node:crypto');
const yaml = require('js-yaml');

async function verifyRelease(directory) {
  const manifest = yaml.load(await fs.readFile(path.join(directory, 'latest.yml'), 'utf8'));
  const version = require('../package.json').version;
  if (manifest.version !== version || !Array.isArray(manifest.files) || !manifest.files.length) throw Error('Update manifest version/files mismatch');
  for (const file of manifest.files) {
    const expected = `CGP-Launcher-Rebuilt-Setup-${version}-x64.exe`;
    if (file.url !== expected) throw Error('Unexpected update asset: ' + file.url);
    const bytes = await fs.readFile(path.join(directory, file.url));
    if (bytes.length !== file.size || createHash('sha512').update(bytes).digest('base64') !== file.sha512) throw Error('Update manifest checksum mismatch');
    if (bytes[0] !== 0x4d || bytes[1] !== 0x5a) throw Error('Installer is not a Windows executable');
    const blockmap = await fs.stat(path.join(directory, file.url + '.blockmap'));
    if (!blockmap.size) throw Error('Missing update blockmap');
  }
  const config = yaml.load(await fs.readFile(path.join(directory, 'win-unpacked/resources/app-update.yml'), 'utf8'));
  if (config.provider !== 'github' || config.owner !== 'Ren112-lotus' || config.repo !== 'CGPLauncher') throw Error('Update provider mismatch');
  const {extractFile} = await import('@electron/asar');
  const archive = path.join(directory,'win-unpacked/resources/app.asar');
  const packaged = JSON.parse(extractFile(archive,'package.json').toString('utf8'));
  if (packaged.version !== version) throw Error('Packaged version mismatch');
  if (!extractFile(archive,'src/updater.cjs').length) throw Error('Updater missing from application archive');
  console.log(`Verified installer, SHA-512, blockmap, GitHub feed, and packaged updater (${version}).`);
}
module.exports = {verifyRelease};
if (require.main === module) {
  const {version} = require('../package.json');
  verifyRelease(path.join(__dirname,'..','..','CGP-Launcher-Windows',version)).catch(error=>{console.error(error);process.exitCode=1;});
}
