const express = require("express");
const cors = require("cors");
const app = express();
const cookieParser = require("cookie-parser");
const port = process.env.PORT || 5000;

const admin = require("firebase-admin");

const serviceAccount = require("./firebase-admin-service-key.json");

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
require("dotenv").config();

// middleware
app.use(
  cors({
    origin: ["https://prod-query-e68b6.web.app"],
    credentials: true,
  })
);

app.use(express.json());
app.use(cookieParser());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.9rzwgbq.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const verifyFireBaseToken = async (req, res, next) => {
  const authHeader = req.headers?.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).send({ message: "unauthorized access" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = await admin.auth().verifyIdToken(token);
    console.log("decoded token", decoded);
    req.decoded = decoded;
    next();
  } catch (error) {
    return res.status(401).send({ message: "unauthorized access" });
  }
};

const verifyTokenEmail = (req, res, next) => {
  const email = req.query.email;
  const decodedEmail = req.decoded?.email; // safety check

  if (!email || !decodedEmail || email !== decodedEmail) {
    return res.status(403).send({ message: "forbidden access" });
  }

  next();
};

async function run() {
  try {
    // Get the collection from the 'prodQuery' database
    const queryCollection = client.db("prodQuery").collection("query");
    const recommendationCollection = client
      .db("prodQuery")
      .collection("recommendations");

    app.post("/query", async (req, res) => {
      const query = req.body;
      const result = await queryCollection.insertOne(query);
      res.send(result);
    });

    app.get("/querys/recent", async (req, res) => {
      const recentQuerys = await queryCollection
        .find()
        .sort({ createdAt: -1 })
        .limit(6)
        .toArray();
      res.send(recentQuerys);
    });

    app.get("/highlighted-products", async (req, res) => {
      try {
        const highlighted = await queryCollection
          .find()
          .sort({ recommendationCount: -1 }) // বেশি রেকমেন্ডেড আগে
          .limit(8) // টপ ৬ বা যত খুশি
          .toArray();

        res.send(highlighted);
      } catch (error) {
        res
          .status(500)
          .send({ message: "Failed to fetch highlighted products" });
      }
    });

    app.get("/allQuery", async (req, res) => {
      const allQuery = await queryCollection.find().toArray();
      res.send(allQuery);
    });

    app.get("/queryDetails/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await queryCollection.findOne(query);
      res.send(result);
    });

    app.get(
      "/myQuery",
      verifyFireBaseToken,
      // verifyTokenEmail,
      async (req, res) => {
        const email = req.query.email;
        const query = {};

        if (email) {
          query.hr_email = email;
        }

        const cursor = queryCollection.find(query).sort({ createdAt: -1 });

        const result = await cursor.toArray();

        res.send(result);
      }
    );

    app.get("/myQueryDetails/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await queryCollection.findOne(query);
      res.send(result);
    });

    app.put("/query/:id", async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const options = { upsert: true };
      const updatedQuery = req.body;
      const updateDoc = {
        $set: updatedQuery,
      };

      const result = await queryCollection.updateOne(
        filter,
        updateDoc,
        options
      );
      res.send(result);
    });

    app.delete("/query/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await queryCollection.deleteOne(query);
      res.send(result);
    });

    app.post("/recommendations", async (req, res) => {
      const recommendation = req.body;
      const result = await recommendationCollection.insertOne(recommendation);

      await queryCollection.updateOne(
        { _id: new ObjectId(recommendation.queryId) },
        { $inc: { recommendationCount: 1 } }
      );

      res.send(result);
    });

    app.get("/recommendations", async (req, res) => {
      const { queryId } = req.query;
      const result = await recommendationCollection.find({ queryId }).toArray();
      res.send(result);
    });

    app.get(
      "/my-recommendations",
      verifyFireBaseToken,
      // verifyTokenEmail,
      async (req, res) => {
        const email = req.query.email;

        if (!email) {
          return res.status(400).send({ message: "Email is required" });
        }

        const result = await recommendationCollection
          .find({ recommenderEmail: email })
          .sort({ timestamp: -1 })
          .toArray();

        res.send(result);
      }
    );

    app.delete("/my-recommendations/:id", async (req, res) => {
      const id = req.params.id;
      const recommendations = { _id: new ObjectId(id) };
      const result = await recommendationCollection.deleteOne(recommendations);
      res.send(result);
    });

    app.patch("/query/:id", async (req, res) => {
      const queryId = req.params.id;
      const result = await queryCollection.updateOne(
        { _id: new ObjectId(queryId) },
        { $inc: { recommendationCount: -1 } }
      );
      res.send(result);
    });

    app.get(
      "/recommendations-for-me",
      verifyFireBaseToken,
      // verifyTokenEmail,
      async (req, res) => {
        const email = req.query.email;

        const query = email ? { userEmail: email } : {};

        const result = await recommendationCollection.find(query).toArray();

        res.send(result);
      }
    );

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Prod Query to be ready");
});

app.listen(port, () => {
  console.log(`Prod Query server is runing on port ${port}`);
});
