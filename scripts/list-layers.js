import fs from 'fs';

const map = JSON.parse(fs.readFileSync('public/static/assets/village/tilemap/tilemap.json', 'utf8'));

console.log("Layers found:");
if (map.layers) {
    map.layers.forEach(l => {
        console.log(`- ${l.name} (type: ${l.type}, visible: ${l.visible})`);
    });
} else {
    console.log("No layers found in top-level object.");
}
