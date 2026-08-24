const jsdom = require('jsdom');
const { JSDOM } = jsdom;
const fs = require('fs');
const html = fs.readFileSync('index.html', 'utf8');

const dom = new JSDOM(html, { runScripts: "dangerously", resources: "usable" });

dom.window.addEventListener('error', (event) => {
    console.log('Error:', event.error);
});
dom.window.addEventListener('firebase-ready', () => {
    console.log('Firebase ready fired!');
});
setTimeout(() => {
    console.log('Timeout. firebaseDb:', dom.window._firebaseDb ? 'Exists' : 'Missing');
    process.exit(0);
}, 5000);
