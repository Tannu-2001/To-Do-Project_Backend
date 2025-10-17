// load .env first
require('dotenv').config();

const express = require("express");
const cors = require("cors");
const path = require("path");
const { MongoClient, ObjectId } = require("mongodb");

const app = express();
app.use(cors());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

/* --------- frontend static --------- */
// adjust relative path if your folder differs
const frontendPublicPath = path.join(__dirname, "../../Frontend/public");
console.log("Serving frontend from:", frontendPublicPath);

// DEBUG: show if env loaded
console.log('ENV loaded:', !!process.env.MONGO_URI, ' DB_NAME=', process.env.DB_NAME);

// simple request logger (helps debug which files are requested)
app.use((req, res, next) => {
  console.log("REQUEST:", req.method, req.url);
  next();
});

// serve static files (so /src/styles/index.css etc. are served)
app.use(express.static(frontendPublicPath));

/* --------- MongoDB (connect once) --------- */
const CON_STRING = process.env.MONGO_URI || "mongodb://127.0.0.1:27017";
const DB_NAME = process.env.DB_NAME || "todo";

// create client (don't pass deprecated options)
const client = new MongoClient(CON_STRING);

async function initDb() {
  // connect only if not already connected
  // Use topology check - safe for modern driver
  if (!client.topology || client.topology.isDestroyed()) {
    console.log('Mongo client not connected, connecting now...');
    await client.connect();
    console.log('Mongo client connect() resolved');
  }
  // return the selected DB
  return client.db(DB_NAME);
}

/* --------- API routes --------- */

// get user by id
app.get("/users/:userid", async (req, res) => {
  try {
    const db = await initDb();
    const user = await db.collection("users").findOne({ user_id: req.params.userid });
    if (!user) return res.status(404).json(null);
    res.json(user);
  } catch (err) {
    console.error('Error /users/:userid', err);
    res.status(500).json({ error: "Server error" });
  }
});

// get appointments for a user
app.get("/appointments/user/:userid", async (req, res) => {
  try {
    const db = await initDb();
    const docs = await db.collection("appointments").find({ user_id: req.params.userid }).toArray();
    res.json(docs);
  } catch (err) {
    console.error('Error /appointments/user/:userid', err);
    res.status(500).json({ error: "Server error" });
  }
});

// get single appointment (robust)
app.get("/appointment/:id", async (req, res) => {
  try {
    const db = await initDb();
    const raw = req.params.id;
    let doc = null;

    const num = Number(raw);
    if (!Number.isNaN(num)) {
      doc = await db.collection("appointments").findOne({ appointment_id: num });
    }

    if (!doc) {
      doc = await db.collection("appointments").findOne({ appointment_id: raw });
    }

    if (!doc && ObjectId.isValid(raw)) {
      doc = await db.collection("appointments").findOne({ _id: new ObjectId(raw) });
    }

    if (!doc) return res.status(404).json(null);
    res.json(doc);
  } catch (err) {
    console.error('Error /appointment/:id', err);
    res.status(500).json({ error: "Server error" });
  }
});

// register user
app.post("/register-user", async (req, res) => {
  try {
    const db = await initDb();
    const user = {
      user_id: req.body.user_id,
      user_name: req.body.user_name,
      password: req.body.password,
      mobile: req.body.mobile,
    };
    const r = await db.collection("users").insertOne(user);

    // DEBUG: show where it was written
    console.log('Inserted user -> db:', db.databaseName, 'collection: users, insertedId:', r.insertedId);

    res.status(201).json({ message: "User Registered", insertedId: r.insertedId });
  } catch (err) {
    console.error('Error in /register-user:', err);
    res.status(500).json({ error: "Server error" });
  }
});

// add appointment
app.post("/add-appointment", async (req, res) => {
  try {
    const db = await initDb();

    let appointmentId = req.body.appointment_id;
    if (typeof appointmentId === "undefined" || appointmentId === "" || appointmentId === null) {
      appointmentId = Date.now();
    } else {
      if (!Number.isNaN(Number(appointmentId))) {
        appointmentId = Number(appointmentId);
      }
    }

    const appointment = {
      appointment_id: appointmentId,
      title: req.body.title,
      description: req.body.description,
      date: req.body.date ? new Date(req.body.date) : null,
      user_id: req.body.user_id,
    };

    const r = await db.collection("appointments").insertOne(appointment);
    console.log('Inserted appointment -> db:', db.databaseName, 'collection: appointments, insertedId:', r.insertedId);
    res.status(201).json({ message: "Appointment Added", insertedId: r.insertedId });
  } catch (err) {
    console.error('Error in /add-appointment:', err);
    res.status(500).json({ error: "Server error" });
  }
});

// edit appointment
app.put("/edit-appointment/:id", async (req, res) => {
  try {
    const db = await initDb();
    const raw = req.params.id;

    const appointment = {
      appointment_id:
        typeof req.body.appointment_id !== "undefined" && req.body.appointment_id !== ""
          ? (isNaN(Number(req.body.appointment_id)) ? req.body.appointment_id : Number(req.body.appointment_id))
          : null,
      title: req.body.title,
      description: req.body.description,
      date: req.body.date ? new Date(req.body.date) : null,
      user_id: req.body.user_id,
    };

    const num = Number(raw);
    let r;
    if (!Number.isNaN(num)) {
      r = await db.collection("appointments").updateOne({ appointment_id: num }, { $set: appointment });
      if (r.matchedCount) return res.json({ message: "Appointment Updated" });
    }

    r = await db.collection("appointments").updateOne({ appointment_id: raw }, { $set: appointment });
    if (r.matchedCount) return res.json({ message: "Appointment Updated" });

    if (ObjectId.isValid(raw)) {
      r = await db.collection("appointments").updateOne({ _id: new ObjectId(raw) }, { $set: appointment });
      if (r.matchedCount) return res.json({ message: "Appointment Updated" });
    }

    return res.status(404).json({ error: "Not found" });
  } catch (err) {
    console.error('Error in /edit-appointment/:id', err);
    res.status(500).json({ error: "Server error" });
  }
});

// delete appointment
app.delete("/delete-appointment/:id", async (req, res) => {
  try {
    const db = await initDb();
    const raw = req.params.id;

    const num = Number(raw);
    let r;
    if (!Number.isNaN(num)) {
      r = await db.collection("appointments").deleteOne({ appointment_id: num });
      if (r.deletedCount > 0) return res.json({ message: "Appointment Deleted" });
    }

    r = await db.collection("appointments").deleteOne({ appointment_id: raw });
    if (r.deletedCount > 0) return res.json({ message: "Appointment Deleted" });

    if (ObjectId.isValid(raw)) {
      r = await db.collection("appointments").deleteOne({ _id: new ObjectId(raw) });
      if (r.deletedCount > 0) return res.json({ message: "Appointment Deleted" });
    }

    return res.status(404).json({ error: "Not found" });
  } catch (err) {
    console.error('Error in /delete-appointment/:id', err);
    res.status(500).json({ error: "Server error" });
  }
});

/* --------- Serve index at root only --------- */
app.get("/", (req, res) => {
  const indexFile = path.join(frontendPublicPath, "index.html");
  res.sendFile(indexFile, (err) => {
    if (err) {
      console.error("Error sending index file:", err);
      res.status(500).send("Server error");
    }
  });
});

/* --------- Start server --------- */
const PORT = process.env.PORT || 4040;
app.listen(PORT, async () => {
  try {
    // try to connect at startup (safe: initDb will also ensure connection on demand)
    await client.connect();
    console.log("Connected to MongoDB (initial connect)");
  } catch (err) {
    console.warn("Could not connect to MongoDB at startup:", err.message);
  }
  console.log(`Server started at http://127.0.0.1:${PORT}`);
});

// graceful shutdown
process.on("SIGINT", async () => {
  console.log("Shutting down...");
  try {
    await client.close();
    console.log("Mongo client closed");
  } catch (e) {
    console.warn("Error closing client:", e.message);
  }
  process.exit(0);
});

