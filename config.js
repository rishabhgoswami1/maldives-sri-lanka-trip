// Where the trip data lives: a Firebase Realtime Database, read and written over plain HTTPS.
// Nothing private is in this file or anywhere in this repository:
// the bring list and the plan are in the database, and it only answers for the right password.
window.TRIP_CONFIG = {
  db: "https://maldives-sri-lanka-trip-default-rtdb.asia-southeast1.firebasedatabase.app"
};
