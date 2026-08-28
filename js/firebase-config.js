// firebaseConfig is defined in firebase-credentials.js (gitignored locally)
// or injected by GitHub Actions during deployment.
firebase.initializeApp(firebaseConfig)
const db = firebase.firestore()
