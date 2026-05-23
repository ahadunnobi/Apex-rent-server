const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || "apex-rent-jwt-secret-change-in-production";
const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:3000";

const allowedOrigins = process.env.CLIENT_URL 
  ? process.env.CLIENT_URL.split(',').map(url => url.trim())
  : ["http://localhost:3000", "http://localhost:5000", "https://apex-rent.onrender.com"];

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
};

app.use(cors(corsOptions));
app.use(cookieParser());
app.use(express.json());

const uri = process.env.MONGODB;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

let db;
let usersCollection;
let carsCollection;
let bookingsCollection;

function getServerUrl(req) {
  if (process.env.SERVER_URL) return process.env.SERVER_URL.replace(/\/$/, "");
  const proto = req.headers["x-forwarded-proto"] || req.protocol || "http";
  const host = req.headers["x-forwarded-host"] || req.get("host");
  return `${proto}://${host}`;
}

function createToken(user) {
  return jwt.sign(
    { email: user.email, name: user.name, photo: user.photo },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
}

function setAuthCookie(res, token) {
  const isProd = process.env.NODE_ENV === "production";
  res.cookie("token", token, {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? "none" : "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

function clearAuthCookie(res) {
  const isProd = process.env.NODE_ENV === "production";
  res.clearCookie("token", {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? "none" : "lax",
  });
}

function verifyToken(req, res, next) {
  const token = req.cookies?.token;
  if (!token) {
    return res.status(401).send({ error: "Unauthorized. Please log in." });
  }
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).send({ error: "Invalid or expired session." });
  }
}

function validatePassword(password) {
  if (!password || password.length < 6) {
    return "Password must be at least 6 characters.";
  }
  if (!/[A-Z]/.test(password)) {
    return "Password must contain an uppercase letter.";
  }
  if (!/[a-z]/.test(password)) {
    return "Password must contain a lowercase letter.";
  }
  return null;
}

// --- AUTH ROUTES ---

app.post("/auth/register", async (req, res) => {
  try {
    const { name, email, photo, password } = req.body;
    if (!name || !email || !password) {
      return res.status(400).send({ error: "Name, email, and password are required." });
    }
    const passwordError = validatePassword(password);
    if (passwordError) {
      return res.status(400).send({ error: passwordError });
    }
    const existing = await usersCollection.findOne({ email: email.toLowerCase() });
    if (existing) {
      return res.status(400).send({ error: "Email is already registered." });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    await usersCollection.insertOne({
      name,
      email: email.toLowerCase(),
      photo: photo || `https://api.dicebear.com/7.x/avataaars/svg?seed=${email}`,
      password: hashedPassword,
      createdAt: new Date(),
    });
    res.send({ success: true, message: "Registration successful. Please log in." });
  } catch (error) {
    console.error("Register error:", error);
    res.status(500).send({ error: "Registration failed." });
  }
});

app.post("/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).send({ error: "Email and password are required." });
    }
    const user = await usersCollection.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(401).send({ error: "Invalid email or password." });
    }
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(401).send({ error: "Invalid email or password." });
    }
    const token = createToken(user);
    setAuthCookie(res, token);
    res.send({
      name: user.name,
      email: user.email,
      photo: user.photo,
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).send({ error: "Login failed." });
  }
});

app.get("/auth/me", verifyToken, (req, res) => {
  res.send({
    name: req.user.name,
    email: req.user.email,
    photo: req.user.photo,
  });
});

app.post("/auth/logout", (req, res) => {
  clearAuthCookie(res);
  res.send({ success: true });
});

app.get("/auth/google", (req, res) => {
  const redirectUri = `${getServerUrl(req)}/auth/google/callback`;
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    access_type: "online",
    prompt: "select_account",
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

app.get("/auth/google/callback", async (req, res) => {
  try {
    const { code } = req.query;
    if (!code) {
      return res.redirect(`${CLIENT_URL}/login?error=google_failed`);
    }
    const redirectUri = `${getServerUrl(req)}/auth/google/callback`;
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      return res.redirect(`${CLIENT_URL}/login?error=google_failed`);
    }
    const profileRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const profile = await profileRes.json();
    if (!profile.email) {
      return res.redirect(`${CLIENT_URL}/login?error=google_failed`);
    }
    let user = await usersCollection.findOne({ email: profile.email.toLowerCase() });
    if (!user) {
      const doc = {
        name: profile.name || profile.email.split("@")[0],
        email: profile.email.toLowerCase(),
        photo: profile.picture || `https://api.dicebear.com/7.x/avataaars/svg?seed=${profile.email}`,
        password: await bcrypt.hash(Math.random().toString(36), 10),
        googleId: profile.id,
        createdAt: new Date(),
      };
      await usersCollection.insertOne(doc);
      user = doc;
    }
    const token = createToken(user);
    setAuthCookie(res, token);
    res.redirect(`${CLIENT_URL}/`);
  } catch (error) {
    console.error("Google callback error:", error);
    res.redirect(`${CLIENT_URL}/login?error=google_failed`);
  }
});

// --- CARS ROUTES ---

app.get("/cars", async (req, res) => {
  try {
    const { search, type } = req.query;
    const query = {};
    if (search) {
      query.name = { $regex: search, $options: "i" };
    }
    if (type) {
      query.type = type;
    }
    const result = await carsCollection.find(query).sort({ createdAt: -1 }).toArray();
    res.send(result);
  } catch (error) {
    res.status(500).send({ error: "Failed to fetch cars" });
  }
});

app.get("/cars/my", verifyToken, async (req, res) => {
  try {
    const result = await carsCollection
      .find({
        $or: [{ ownerEmail: req.user.email }, { addedBy: req.user.email }],
      })
      .sort({ createdAt: -1 })
      .toArray();
    res.send(result);
  } catch (error) {
    res.status(500).send({ error: "Failed to fetch your cars" });
  }
});

app.get("/cars/:id", async (req, res) => {
  try {
    const result = await carsCollection.findOne({ _id: new ObjectId(req.params.id) });
    if (!result) return res.status(404).send({ error: "Car not found" });
    res.send(result);
  } catch (error) {
    res.status(500).send({ error: "Failed to fetch car" });
  }
});

app.post("/cars", verifyToken, async (req, res) => {
  try {
    const newCar = {
      ...req.body,
      ownerEmail: req.user.email,
      booking_count: 0,
      createdAt: new Date(),
    };
    delete newCar._id;
    const result = await carsCollection.insertOne(newCar);
    res.send(result);
  } catch (error) {
    res.status(500).send({ error: "Failed to add car" });
  }
});

app.put("/cars/:id", verifyToken, async (req, res) => {
  try {
    const car = await carsCollection.findOne({ _id: new ObjectId(req.params.id) });
    if (!car) return res.status(404).send({ error: "Car not found" });
    const owner = car.ownerEmail || car.addedBy;
    if (owner !== req.user.email) {
      return res.status(403).send({ error: "You can only update your own listings." });
    }
    const updatedCar = { ...req.body };
    delete updatedCar._id;
    delete updatedCar.ownerEmail;
    const result = await carsCollection.updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: updatedCar }
    );
    res.send(result);
  } catch (error) {
    res.status(500).send({ error: "Failed to update car" });
  }
});

app.delete("/cars/:id", verifyToken, async (req, res) => {
  try {
    const car = await carsCollection.findOne({ _id: new ObjectId(req.params.id) });
    if (!car) return res.status(404).send({ error: "Car not found" });
    const owner = car.ownerEmail || car.addedBy;
    if (owner !== req.user.email) {
      return res.status(403).send({ error: "You can only delete your own listings." });
    }
    const result = await carsCollection.deleteOne({ _id: new ObjectId(req.params.id) });
    res.send(result);
  } catch (error) {
    res.status(500).send({ error: "Failed to delete car" });
  }
});

// --- BOOKINGS ROUTES ---

app.get("/bookings/my", verifyToken, async (req, res) => {
  try {
    const result = await bookingsCollection
      .find({ userEmail: req.user.email })
      .sort({ bookingDate: -1 })
      .toArray();
    res.send(result);
  } catch (error) {
    res.status(500).send({ error: "Failed to fetch bookings" });
  }
});

app.post("/bookings", verifyToken, async (req, res) => {
  try {
    const { carId, driverNeeded, specialNote } = req.body;
    if (!carId) {
      return res.status(400).send({ error: "Car ID is required." });
    }
    const car = await carsCollection.findOne({ _id: new ObjectId(carId) });
    if (!car) return res.status(404).send({ error: "Car not found" });
    if (car.availability === "Unavailable") {
      return res.status(400).send({ error: "This car is currently unavailable." });
    }
    const booking = {
      carId: car._id.toString(),
      carName: car.name,
      carImage: car.image,
      carType: car.type,
      location: car.location || car.pickupLocation,
      dailyPrice: Number(car.price),
      totalPrice: Number(car.price),
      driverNeeded: driverNeeded || "No",
      specialNote: specialNote || "",
      userEmail: req.user.email,
      userName: req.user.name,
      bookingDate: new Date(),
      status: "Confirmed",
    };
    const result = await bookingsCollection.insertOne(booking);
    await carsCollection.updateOne(
      { _id: new ObjectId(carId) },
      { $inc: { booking_count: 1 } }
    );
    res.send({ ...booking, _id: result.insertedId });
  } catch (error) {
    console.error("Booking error:", error);
    res.status(500).send({ error: "Failed to create booking" });
  }
});

app.delete("/bookings/:id", verifyToken, async (req, res) => {
  try {
    const booking = await bookingsCollection.findOne({
      _id: new ObjectId(req.params.id),
      userEmail: req.user.email,
    });
    if (!booking) return res.status(404).send({ error: "Booking not found" });
    await bookingsCollection.deleteOne({ _id: new ObjectId(req.params.id) });
    res.send({ success: true });
  } catch (error) {
    res.status(500).send({ error: "Failed to cancel booking" });
  }
});

app.get("/", (req, res) => {
  res.send("Apex Rent Server is running!");
});

async function run() {
  await client.connect();
  db = client.db("apexRentDB");
  usersCollection = db.collection("users");
  carsCollection = db.collection("cars");
  bookingsCollection = db.collection("bookings");
  console.log("Connected to MongoDB — Apex Rent API ready");
}

run().catch(console.dir);

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
