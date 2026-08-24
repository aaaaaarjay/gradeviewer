const jsdom = require('jsdom');
const { JSDOM } = jsdom;
const html = 
<!DOCTYPE html>
<html>
<head></head>
<body>
  <script src="https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js"></script>
  <script src="https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore-compat.js"></script>

  <script>
    const firebaseConfig = {
      apiKey: "AIzaSyCOddhoStINDV88cGGTatEXSIOz2foex-4",
      authDomain: "gradeviewer-online.firebaseapp.com",
      projectId: "gradeviewer-online",
      storageBucket: "gradeviewer-online.firebasestorage.app",
      messagingSenderId: "926273082901",
      appId: "1:926273082901:web:214b7d4e59344acce5e01c"
    };
    firebase.initializeApp(firebaseConfig);
    const db = firebase.firestore();
    console.log('DB created successfully');
    window._firebaseDb = db;
    window._firestoreDoc = (db, col, docId) => db.collection(col).doc(docId);
    window._firestoreGetDoc = (ref) => ref.get();
    window._firestoreSetDoc = (ref, data) => ref.set(data);
    window._firestoreOnSnapshot = (ref, callback) => ref.onSnapshot(callback);
    
    // Test the getter
    const docRef = window._firestoreDoc(db, 'gradeviewer', 'classes');
    window._firestoreGetDoc(docRef).then(snap => {
        console.log('snap.exists property:', snap.exists);
        console.log('snap.data():', snap.data());
    }).catch(e => {
        console.log('GetDoc error:', e.message);
    });

    window.dispatchEvent(new Event('firebase-ready'));
  </script>
</body>
</html>
;

const dom = new JSDOM(html, { runScripts: "dangerously", resources: "usable" });

dom.window.addEventListener('error', (event) => {
    console.log('Error:', event.error.message || event.error);
});
dom.window.addEventListener('firebase-ready', () => {
    console.log('Firebase ready fired!');
});
setTimeout(() => {
    console.log('Done');
    process.exit(0);
}, 5000);
