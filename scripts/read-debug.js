
const fs = require('fs');
const path = require('path');

const filePath = path.join(process.cwd(), 'thread_debug.txt');

try {
    const content = fs.readFileSync(filePath, 'utf8');
    console.log(content);
} catch (err) {
    console.error('Error reading file:', err);
}
