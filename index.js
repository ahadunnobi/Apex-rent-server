const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 5000;

// Middlewares
app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:3000',
  credentials: true,
}));
app.use(express.json());
app.use(cookieParser());

// MongoDB URI
const uri = process.env.MONGODB;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

// Verify JWT Middleware
const verifyToken = (req, res, next) => {
  const token = req.cookies?.token;
  if (!token) {
    return res.status(401).send({ message: 'Unauthorized access' });
  }
  jwt.verify(token, process.env.JWT_SECRET || 'secret_fallback', (err, decoded) => {
    if (err) {
      return res.status(401).send({ message: 'Unauthorized access' });
    }
    req.user = decoded;
    next();
  });
};

async function run() {
  try {
    await client.connect();
    const db = client.db("apexRentDB");
    const carsCollection = db.collection("cars");
    const bookingsCollection = db.collection("bookings");

    // --- JWT API ---
    app.post('/jwt', async (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.JWT_SECRET || 'secret_fallback', { expiresIn: '1h' });
      res.cookie('token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
      }).send({ success: true });
    });

    app.post('/logout', async (req, res) => {
      res.clearCookie('token', {
        maxAge: 0,
        secure: process.env.NODE_ENV === 'production',
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
      }).send({ success: true });
    });

    // --- CARS API ---

    // Get all cars (with search and filter)
    app.get('/cars', async (req, res) => {
      const { search, type } = req.query;
      let query = {};

      if (search) {
        query.name = { $regex: search, $options: 'i' };
      }
      if (type && type !== 'All') {
        query.type = type;
      }

      const result = await carsCollection.find(query).toArray();
      res.send(result);
    });

    // Get specific car details
    app.get('/cars/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await carsCollection.findOne(query);
      res.send(result);
    });

    // Get cars added by specific user (protected)
    app.get('/my-cars', verifyToken, async (req, res) => {
      const email = req.query.email;
      if (req.user.email !== email) {
        return res.status(403).send({ message: 'Forbidden access' });
      }
      const query = { ownerEmail: email };
      // Sort by latest added (assuming descending order)
      const result = await carsCollection.find(query).sort({ _id: -1 }).toArray();
      res.send(result);
    });

    // Add a new car (protected)
    app.post('/cars', verifyToken, async (req, res) => {
      const newCar = req.body;
      newCar.booking_count = 0; // Initialize booking count
      newCar.createdAt = new Date();
      const result = await carsCollection.insertOne(newCar);
      res.send(result);
    });

    // Update a car (protected)
    app.put('/cars/:id', verifyToken, async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const updatedCar = req.body;
      const updateDoc = {
        $set: {
          price: updatedCar.price,
          description: updatedCar.description,
          availability: updatedCar.availability,
          image: updatedCar.image,
          type: updatedCar.type,
          location: updatedCar.location,
        },
      };
      const result = await carsCollection.updateOne(filter, updateDoc);
      res.send(result);
    });

    // Delete a car (protected)
    app.delete('/cars/:id', verifyToken, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await carsCollection.deleteOne(query);
      res.send(result);
    });


    // --- BOOKINGS API ---

    // Book a car (protected)
    app.post('/bookings', verifyToken, async (req, res) => {
      const booking = req.body;
      booking.bookingDate = new Date();

      // Start transaction or do it sequentially
      // 1. Insert booking
      const result = await bookingsCollection.insertOne(booking);

      // 2. Increase booking count using $inc
      const carId = booking.carId;
      await carsCollection.updateOne(
        { _id: new ObjectId(carId) },
        { $inc: { booking_count: 1 } }
      );

      res.send(result);
    });

    // Get bookings for logged-in user (protected)
    app.get('/bookings/my-bookings', verifyToken, async (req, res) => {
      const email = req.query.email;
      if (req.user.email !== email) {
        return res.status(403).send({ message: 'Forbidden access' });
      }
      const query = { userEmail: email };
      const result = await bookingsCollection.find(query).toArray();
      res.send(result);
    });

    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Keeps connection alive in Express
  }
}
run().catch(console.dir);

app.get('/', (req, res) => {
  res.send('Apex Rent Server is running...');
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
