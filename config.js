// Where the shared bring list lives: a Firebase Realtime Database, read and written over plain HTTPS.
// Empty until the database exists. The list's private key is NOT kept here (this file is public):
// it travels in the link, after "#k=".
window.TRIP_CONFIG = {
  db: ""
};
