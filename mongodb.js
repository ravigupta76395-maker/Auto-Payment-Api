const { MongoClient } = require("mongodb");

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB || "deposit_gateway";

let cachedClient = null;
let cachedDb = null;

async function getDb() {
  if (cachedDb) return cachedDb;

  if (!uri) {
    throw new Error("MONGODB_URI env var is not set");
  }

  if (!cachedClient) {
    cachedClient = new MongoClient(uri);
    await cachedClient.connect();
  }

  cachedDb = cachedClient.db(dbName);

  // Make sure indexes exist (safe to call repeatedly, MongoDB no-ops if already present)
  await cachedDb.collection("orders").createIndex({ order_id: 1 }, { unique: true });
  await cachedDb
    .collection("orders")
    .createIndex({ bot_id: 1, user_id: 1, status: 1 });
  await cachedDb.collection("used_utrs").createIndex({ utr: 1 }, { unique: true });

  return cachedDb;
}

module.exports = { getDb };
