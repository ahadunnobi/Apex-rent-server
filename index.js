const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const { createRemoteJWKSet, jwtVerify } = require("jose-cjs");
dotenv.config();

const uri = process.env.MONGODB;

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

const JWKS = createRemoteJWKSet(new URL(`${process.env.CLIENT_URL}/api/auth/jwks`));

const verifyToken = async (req, res, next) => {
  const authHeader = req?.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  const token = authHeader.split(" ")[1];
  if (!token) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  try {
    const { payload } = await jwtVerify(token, JWKS);
    console.log(payload);
    req.user = payload;
    next();
  } catch (error) {
    return res.status(403).json({ message: "Forbidden" });
  }
};

const db = client.db("apexRentDB");
const carsCollection = db.collection("cars");
const bookingsCollection = db.collection("bookings");

app.get("/cars", async (req, res) => {
      try {
        const { search, type } = req.query;
        const query = {};
        const conditions = [];

        if (search) {
          conditions.push({
            $or: [
              { name: { $regex: search, $options: "i" } },
              { car_name: { $regex: search, $options: "i" } }
            ]
          });
        }

        if (type) {
          conditions.push({
            $or: [
              { type: type },
              { car_type: type }
            ]
          });
        }

        if (conditions.length > 0) {
          query.$and = conditions;
        }

        const result = await carsCollection.find(query).sort({ createdAt: -1 }).toArray();
        res.json(result);
      } catch (error) {
        res.status(500).json({ message: "Failed to fetch cars" });
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
        res.json(result);
      } catch (error) {
        res.status(500).json({ message: "Failed to fetch your cars" });
      }
    });

    app.get("/cars/:id", async (req, res) => {
      try {
        const { id } = req.params;
        const result = await carsCollection.findOne({ _id: new ObjectId(id) });
        if (!result) return res.status(404).json({ message: "Car not found" });
        res.json(result);
      } catch (error) {
        res.status(500).json({ message: "Failed to fetch car" });
      }
    });

    app.post("/cars", verifyToken, async (req, res) => {
      try {
        const carData = req.body;
        const newCar = {
          ...carData,
          ownerEmail: req.user.email,
          booking_count: 0,
          createdAt: new Date(),
        };
        delete newCar._id;
        const result = await carsCollection.insertOne(newCar);
        res.json(result);
      } catch (error) {
        res.status(500).json({ message: "Failed to add car" });
      }
    });

    app.put("/cars/:id", verifyToken, async (req, res) => {
      try {
        const { id } = req.params;
        const updatedData = req.body;
        const car = await carsCollection.findOne({ _id: new ObjectId(id) });
        if (!car) {
          return res.status(404).json({ message: "Car not found" });
        }
        const owner = car.ownerEmail || car.addedBy;
        if (owner !== req.user.email) {
          return res.status(403).json({ message: "Forbidden" });
        }
        const updatedCar = { ...updatedData };
        delete updatedCar._id;
        delete updatedCar.ownerEmail;
        const result = await carsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updatedCar }
        );
        res.json(result);
      } catch (error) {
        res.status(500).json({ message: "Failed to update car" });
      }
    });

    app.delete("/cars/:id", verifyToken, async (req, res) => {
      try {
        const { id } = req.params;
        const car = await carsCollection.findOne({ _id: new ObjectId(id) });
        if (!car) {
          return res.status(404).json({ message: "Car not found" });
        }
        const owner = car.ownerEmail || car.addedBy;
        if (owner !== req.user.email) {
          return res.status(403).json({ message: "Forbidden" });
        }
        const result = await carsCollection.deleteOne({ _id: new ObjectId(id) });
        res.json(result);
      } catch (error) {
        res.status(500).json({ message: "Failed to delete car" });
      }
    });

    app.get("/bookings/my", verifyToken, async (req, res) => {
      try {
        const result = await bookingsCollection
          .find({ userEmail: req.user.email })
          .sort({ bookingDate: -1 })
          .toArray();
        res.json(result);
      } catch (error) {
        res.status(500).json({ message: "Failed to fetch bookings" });
      }
    });

    app.post("/bookings", verifyToken, async (req, res) => {
      try {
        const { carId, driverNeeded, specialNote } = req.body;
        if (!carId) {
          return res.status(400).json({ message: "Car ID is required." });
        }
        const car = await carsCollection.findOne({ _id: new ObjectId(carId) });
        if (!car) {
          return res.status(404).json({ message: "Car not found" });
        }
        const booking = {
          carId: car._id.toString(),
          carName: car.car_name || car.name,
          carImage: car.image_url || car.image,
          carType: car.car_type || car.type,
          location: car.pickup_location || car.location,
          dailyPrice: Number(car.daily_rent_price || car.price),
          totalPrice: Number(car.daily_rent_price || car.price),
          driverNeeded: driverNeeded || "No",
          specialNote: specialNote || "",
          userEmail: req.user.email,
          userName: req.user.name || req.user.email?.split("@")[0],
          bookingDate: new Date(),
          status: "Confirmed",
        };
        const result = await bookingsCollection.insertOne(booking);
        
        await carsCollection.updateOne(
          { _id: new ObjectId(carId) },
          { $inc: { booking_count: 1 } }
        );

        res.json({ ...booking, _id: result.insertedId });
      } catch (error) {
        console.error("Booking error:", error);
        res.status(500).json({ message: "Failed to create booking" });
      }
    });

    app.delete("/bookings/:id", verifyToken, async (req, res) => {
      try {
        const { id } = req.params;
        const booking = await bookingsCollection.findOne({
          _id: new ObjectId(id),
          userEmail: req.user.email,
        });
        if (!booking) {
          return res.status(404).json({ message: "Booking not found" });
        }
        await bookingsCollection.deleteOne({ _id: new ObjectId(id) });
        res.json({ success: true });
      } catch (error) {
        res.status(500).json({ message: "Failed to cancel booking" });
      }
    });

async function run() {
  try {
    await client.connect();
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } catch (error) {
    console.dir(error);
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Server is running fine!");
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});


