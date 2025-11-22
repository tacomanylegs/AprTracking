const fs = require('fs');
const path = require('path');

const base64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const buffer = Buffer.from(base64, 'base64');

fs.writeFileSync(path.join(__dirname, 'assets', 'icon.png'), buffer);
console.log('Created icon.png');
