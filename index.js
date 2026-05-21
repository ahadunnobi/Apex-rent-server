const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// MongoDB URI
const uri = process.env.MONGODB;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    await client.connect();
    const db = client.db("apexRentDB");
    const carsCollection = db.collection("cars");

    // --- CARS API ---

    // 1. GET: Fetch all cars
    app.get('/cars', async (req, res) => {
      try {
        const result = await carsCollection.find().toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({ error: 'Failed to fetch cars' });
      }
    });

    // 2. GET: Fetch a single car by ID
    app.get('/cars/:id', async (req, res) => {
      try {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const result = await carsCollection.findOne(query);
        res.send(result);
      } catch (error) {
        res.status(500).send({ error: 'Failed to fetch car' });
      }
    });

    // 3. POST: Add a new car
    app.post('/cars', async (req, res) => {
      try {
        const newCar = req.body;
        // Optionally add timestamp
        newCar.createdAt = new Date();
        const result = await carsCollection.insertOne(newCar);
        res.send(result);
      } catch (error) {
        res.status(500).send({ error: 'Failed to add car' });
      }
    });

    // 4. PUT: Update a car by ID
    app.put('/cars/:id', async (req, res) => {
      try {
        const id = req.params.id;
        const filter = { _id: new ObjectId(id) };
        const updatedCar = req.body;
        
        // Exclude _id from update doc if it was sent in the body
        delete updatedCar._id;

        const updateDoc = {
          $set: updatedCar,
        };
        const result = await carsCollection.updateOne(filter, updateDoc);
        res.send(result);
      } catch (error) {
        res.status(500).send({ error: 'Failed to update car' });
      }
    });

    // 5. DELETE: Remove a car by ID
    app.delete('/cars/:id', async (req, res) => {
      try {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const result = await carsCollection.deleteOne(query);
        res.send(result);
      } catch (error) {
        res.status(500).send({ error: 'Failed to delete car' });
      }
    });

    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Keeps connection alive in Express
  }
}
run().catch(console.dir);

app.get('/', (req, res) => {
  res.send('Apex Rent Server is running! Car APIs are ready.');
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
