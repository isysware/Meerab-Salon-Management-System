const fs=require('fs'),path=require('path'),crypto=require('crypto');
const files=process.argv.slice(2);
fs.writeFileSync(path.join(__dirname,'manifest.json'),JSON.stringify(files.map(file=>{
 const target=path.resolve('../backend',file);
 return {file,hash:fs.existsSync(target)?crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex'):null};
})));
