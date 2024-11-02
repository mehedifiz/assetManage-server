const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
require("dotenv").config();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const app = express();
const port = process.env.PORT || 8000;

const corsOptions = {
  origin: ["http://localhost:5173", "https://asset-management-c4990.web.app"],
  credentials: true,
  optionSuccessStatus: 200,
};
app.use(cors(corsOptions));
app.use(express.json());

// MongoDB Starts Here
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.pbz3kui.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

console.log(uri);

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Collections
    const usersCollection = client.db("assetDB").collection("users");
    const paymentCollection = client.db("assetDB").collection("payments");
    const assetsCollection = client.db("assetDB").collection("assets");
    const requestedAssetsCollection = client
      .db("assetDB")
      .collection("requestedAssets");

    // JWT
    app.post("/jwt", async (request, response) => {
      const user = request.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: "365d",
      });
      response.send({ token });
    });

    // Verify Token
    const verifyToken = (request, response, next) => {
      // console.log("vToken", request.headers.authorization);
      if (!request.headers.authorization) {
        return response.status(401).send({ message: "forbidden access 1" });
      }
      const token = request.headers.authorization.split(" ")[1];
      jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
        if (err) {
          console.log(err);
          return response.status(401).send({ message: "forbidden access 2" });
        }
        request.decoded = decoded;
        next();
      });
    };

    // Verify HR
    const verifyHR = async (request, response, next) => {
      const email = request.decoded.email;
      const query = { email: email };
      const user = await usersCollection.findOne(query);
      const isHR = user?.role === "hr";
      if (!isHR) {
        return response.status(403).send({ message: "forbidden 1" });
      }
      next();
    };

    // Verify Employee
    const verifyEmployee = async (request, response, next) => {
      const email = request.decoded.email;
      const query = { email: email };
      const user = await usersCollection.findOne(query);
      const isEmployee = user?.role === "employee";
      if (!isEmployee) {
        return response.status(403).send({ message: "forbidden 2" });
      }
      next();
    };

    // Create User to store into database
    app.post("/users", async (request, response) => {
      const user = request.body;
      const emailQuery = { email: user.email };
      const companyQuery = { company_name: user.company_name };
      const role = user.role;

      const existingUser = await usersCollection.findOne(emailQuery);
      const existingCompany = await usersCollection.findOne(companyQuery);

      if (existingUser) {
        return response.send({
          message: "User Already Exists!",
          insertedId: null,
        });
      }

      if (role == "hr" && existingCompany) {
        return response.send({
          message: "Company Name Already Exists!",
          insertedId: null,
        });
      }

      const result = await usersCollection.insertOne(user);
      response.send(result);
    });

    // Make Api to get all users 
    app.get("/users", verifyToken, verifyHR, async (request, response) => {
      const result = await usersCollection.find().toArray();
      response.send(result);
    });

    // Make Api to get HR User
    app.get("/users/hr/:email", async (request, response) => {
      const email = request.params.email;
      const query = { email: email };
      const user = await usersCollection.findOne(query);
      let hr = false;
      if (user) {
        hr = user?.role === "hr";
      }
      response.send({ hr });
    });

    // Make Api to get Employee User
    app.get("/users/employee/:email", async (request, response) => {
      const email = request.params.email;
      const query = { email: email };
      const user = await usersCollection.findOne(query);
      let employee = false;
      if (user) {
        employee = user?.role === "employee";
      }
      response.send({ employee });
    });

    // Make Api to get specific or login  user data
    app.get("/users/:email", async (req, res) => {
      const email = req.params.email;
      const query = { email: email };
      const user = await usersCollection.findOne(query);
      res.send(user);
    });

    // Update User Name
    app.patch("/users", verifyToken, async (req, res) => {
      const { email, name } = req.body;
      const filter = { email };
      const updateDoc = {
        $set: {
          name,
        },
      };
      const result = await usersCollection.updateOne(filter, updateDoc);
      res.send(result);
    });

    // Add An User To the Company
    app.patch("/users/:id", verifyToken, verifyHR, async (req, res) => {
      const id = req.params.id;
      const { company_name, company_logo } = req.body;
      const filter = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: {
          company_name,
          company_logo,
        },
      };
      const result = await usersCollection.updateOne(filter, updateDoc);
      res.send(result);
    });

    // Remove An User From the Company
    

    // Get Users by Company Name
    app.get(
      "/users/company/:company_name",
      verifyToken,
      async (request, response) => {
        const companyName = request.params.company_name;
        const query = { company_name: companyName };
        const users = await usersCollection.find(query).toArray();
        response.send(users);
      }
    );

    // Add Asset
    app.post("/assets", verifyToken, verifyHR, async (req, res) => {
      const asset = req.body;
      const result = await assetsCollection.insertOne(asset);
      res.send(result);
    });

    // Get Assets
    app.get("/assets", verifyToken, async (req, res) => {
      const { search, filter } = req.query;
      const userEmail = req.decoded.email;

      try {
        const user = await usersCollection.findOne({ email: userEmail });

        if (!user || !user.company_name) {
          return res.status(400).send("User company not found");
        }

        const userCompany = user.company_name;

        let query = { company_name: userCompany };

        if (search) {
          query.product_name = { $regex: search, $options: "i" };
        }

        if (filter) {
          if (filter === "Available") {
            query.product_quantity = { $gt: 0 };
          } else if (filter === "Out Of Stock") {
            query.product_quantity = 0;
          } else if (filter === "Returnable") {
            query.product_type = "Returnable";
          } else if (filter === "Non-Returnable") {
            query.product_type = "Non-Returnable";
          }
        }

        const assets = await assetsCollection.find(query).toArray();
        res.send(assets);
      } catch (error) {
        console.error("Error fetching assets:", error);
        res.status(500).send("Error fetching assets");
      }
    });

    // Get Assets with limited stock by company name
    app.get("/assets/limited-stock/:company_name", async (req, res) => {
      const companyName = req.params.company_name;

      try {
        const assets = await assetsCollection
          .find({
            company_name: companyName,
            product_quantity: { $lt: 10 },
          })
          .toArray();

        res.send(assets);
      } catch (error) {
        console.error("Error fetching limited stock assets:", error);
        res.status(500).send({ error: "Error fetching limited stock assets" });
      }
    });

    // Get A Single Asset
    app.get("/assets/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const asset = await assetsCollection.findOne({ _id: new ObjectId(id) });
      res.send(asset);
    });

    // Update an Asset
    app.put("/assets/:id", verifyToken, verifyHR, async (req, res) => {
      const id = req.params.id;
      const assetUpdates = req.body;
      const filter = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: assetUpdates,
      };
      const result = await assetsCollection.updateOne(filter, updateDoc);
      res.send(result);
    });

    // Delete an asset by ID with company name verification
    app.delete("/assets/:id", verifyToken, verifyHR, async (req, res) => {
      const id = req.params.id;
      const asset = await assetsCollection.findOne({ _id: new ObjectId(id) });
      const result = await assetsCollection.deleteOne({
        _id: new ObjectId(id),
      });
      res.send(result);
    });

    // Add Request for an Asset
    app.post(
      "/requested-assets",
      verifyToken,
      verifyEmployee,
      async (req, res) => {
        const requestedAsset = req.body;

        const session = client.startSession();
        session.startTransaction();

        try {
          const { asset_id } = requestedAsset;

          // Find the asset to check its current quantity
          const asset = await assetsCollection.findOne(
            { _id: new ObjectId(asset_id) },
            { session }
          );

          if (!asset) {
            throw new Error("Asset not found");
          }

          const productQuantity = parseInt(asset.product_quantity);
          if (isNaN(productQuantity) || productQuantity === 0) {
            throw new Error("Asset is out of stock or has an invalid quantity");
          }

          // Insert the requested asset into the collection
          const insertResult = await requestedAssetsCollection.insertOne(
            requestedAsset,
            { session }
          );

          if (insertResult.insertedId) {
            // Decrease the quantity of the asset in the assets collection
            const assetResult = await assetsCollection.updateOne(
              { _id: new ObjectId(asset_id) },
              { $inc: { product_quantity: -1 } },
              { session }
            );

            if (assetResult.modifiedCount === 1) {
              await session.commitTransaction();
              res.send(insertResult);
            } else {
              throw new Error("Failed to update asset quantity");
            }
          } else {
            throw new Error("Failed to insert requested asset");
          }
        } catch (error) {
          console.error("Transaction error:", error);
          await session.abortTransaction();
          res.status(500).send({ message: error.message });
        } finally {
          session.endSession();
        }
      }
    );

    // Approved or Rejected
    app.put(
      "/requested-assets/:id",
      verifyToken,
      verifyHR,
      async (req, res) => {
        const { id } = req.params;
        const { status } = req.body;

        const session = client.startSession();
        session.startTransaction();

        try {
          const requestedAsset = await requestedAssetsCollection.findOne(
            { _id: new ObjectId(id) },
            { session }
          );

          if (!requestedAsset) {
            throw new Error("Requested asset not found");
          }

          // Prepare the update document
          const updateDoc = { $set: { status } };
          if (status === "Approved") {
            updateDoc.$set.approval_date = new Date();
          }

          // Update the status (and approval_date if approved) of the requested asset
          const updateResult = await requestedAssetsCollection.updateOne(
            { _id: new ObjectId(id) },
            updateDoc,
            { session }
          );

          if (status === "Rejected") {
            // Increment the asset quantity if the status is Rejected
            const assetResult = await assetsCollection.updateOne(
              { _id: new ObjectId(requestedAsset.asset_id) },
              { $inc: { product_quantity: 1 } },
              { session }
            );

            if (assetResult.modifiedCount !== 1) {
              throw new Error("Failed to update asset quantity");
            }
          }

          await session.commitTransaction();
          res.send(updateResult);
        } catch (error) {
          console.error("Transaction error:", error);
          await session.abortTransaction();
          res.status(500).send({ message: error.message });
        } finally {
          session.endSession();
        }
      }
    );

    // Get All Requested Assets
    app.get("/requested-assets", async (req, res) => {
      const { email, company_name } = req.query;
      let query = {};

      if (email && company_name) {
        query = {
          requester_email: email,
          requester_company: company_name,
        };
      }

      const requestedAssets = await requestedAssetsCollection
        .find(query)
        .toArray();
      res.send(requestedAssets);
    });

    // Get All Requested Assets By Employee
    app.get("/filtered-requested-assets", verifyToken, async (req, res) => {
      const { company_name, assetName, status, assetType } = req.query;
      const query = {};

      // Get the email from the query parameter or the decoded JWT token
      const email = req.query.email || req.decoded.email;
      if (!email) {
        return res.status(400).send({ error: "Email not provided or invalid" });
      }
      query.requester_email = email;

      if (company_name) {
        query.requester_company = company_name;
      }

      if (assetName) {
        query.asset_name = { $regex: assetName, $options: "i" };
      }

      if (status) {
        query.status = status;
      }

      if (assetType === "Returnable") {
        query.asset_type = "Returnable";
      } else if (assetType === "Non-Returnable") {
        query.asset_type = "Non-Returnable";
      }

      try {
        const result = await requestedAssetsCollection.find(query).toArray();
        res.send(result);
      } catch (error) {
        res
          .status(500)
          .send({ error: "Failed to fetch filtered requested assets" });
      }
    });

    // Cancel a Requested Asset
    app.put(
      "/requested-assets/:id/cancel",
      verifyToken,
      verifyEmployee,
      async (req, res) => {
        const { id } = req.params;

        const session = client.startSession();
        session.startTransaction();

        try {
          const requestedAsset = await requestedAssetsCollection.findOne(
            { _id: new ObjectId(id) },
            { session }
          );

          if (!requestedAsset) {
            throw new Error("Requested asset not found");
          }

          // Update the status of the requested asset to "Cancelled"
          const updateResult = await requestedAssetsCollection.updateOne(
            { _id: new ObjectId(id) },
            { $set: { status: "Cancelled" } },
            { session }
          );

          // Increment the asset quantity in the assets collection
          const assetResult = await assetsCollection.updateOne(
            { _id: new ObjectId(requestedAsset.asset_id) },
            { $inc: { product_quantity: 1 } },
            { session }
          );

          if (
            updateResult.modifiedCount === 1 &&
            assetResult.modifiedCount === 1
          ) {
            await session.commitTransaction();
            res.send(updateResult);
          } else {
            throw new Error("Failed to update asset status or quantity");
          }
        } catch (error) {
          console.error("Transaction error:", error);
          await session.abortTransaction();
          res.status(500).send({ message: error.message });
        } finally {
          session.endSession();
        }
      }
    );

    // Return a Requested Asset
    app.put(
      "/requested-assets/:id/return",
      verifyToken,
      verifyEmployee,
      async (req, res) => {
        const { id } = req.params;

        const session = client.startSession();
        session.startTransaction();

        try {
          const requestedAsset = await requestedAssetsCollection.findOne(
            { _id: new ObjectId(id) },
            { session }
          );

          if (!requestedAsset) {
            throw new Error("Requested asset not found");
          }

          // Check if the asset is already returned
          if (requestedAsset.status === "Returned") {
            throw new Error("Asset is already returned");
          }

          // Update the status of the requested asset to "Returned"
          const updateResult = await requestedAssetsCollection.updateOne(
            { _id: new ObjectId(id) },
            { $set: { status: "Returned" } },
            { session }
          );

          // Increment the asset quantity in the assets collection
          const assetResult = await assetsCollection.updateOne(
            { _id: new ObjectId(requestedAsset.asset_id) },
            { $inc: { product_quantity: 1 } },
            { session }
          );

          if (
            updateResult.modifiedCount === 1 &&
            assetResult.modifiedCount === 1
          ) {
            await session.commitTransaction();
            res.send(updateResult);
          } else {
            throw new Error("Failed to update asset status or quantity");
          }
        } catch (error) {
          console.error("Transaction error:", error);
          await session.abortTransaction();
          res.status(500).send({ message: error.message });
        } finally {
          session.endSession();
        }
      }
    );

    // Payment
    app.post("/create-payment-intent", verifyToken, async (req, res) => {
      const { price } = req.body;
      const amount = parseInt(price * 100);
      console.log(amount, "amount inside the intent");

      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: "usd",
        payment_method_types: ["card"],
      });

      res.send({
        clientSecret: paymentIntent.client_secret,
      });
    });

    app.post("/payments", verifyToken, verifyHR, async (req, res) => {
      const payment = req.body;

      const session = client.startSession();
      session.startTransaction();

      try {
        const paymentResult = await paymentCollection.insertOne(payment, {
          session,
        });

        const filter = { email: payment.hr_email };
        const updateDoc = {
          $set: {
            payment_status: true,
            payment_info: {
              transactionId: payment.transactionId,
              payment_from_company: payment.payment_from_company,
              payment_for_package: payment.payment_for_package,
              date: payment.date,
              price: payment.price,
            },
          },
        };

        const userResult = await usersCollection.updateOne(filter, updateDoc, {
          session,
        });

        if (paymentResult.insertedId && userResult.modifiedCount === 1) {
          await session.commitTransaction();
          res.send({ paymentResult });
        } else {
          throw new Error("Payment or user update failed");
        }
      } catch (error) {
        await session.abortTransaction();
        res.status(500).send({ message: error.message });
      } finally {
        session.endSession();
      }
    });

    // Increase Limit
    app.put("/payments", verifyToken, verifyHR, async (req, res) => {
      const {
        email,
        additionalLimit,
        transactionId,
        payment_from_company,
        payment_for_package,
        price,
      } = req.body;

      console.log("Received payment update request:", req.body);

      if (
        !email ||
        !transactionId ||
        !payment_from_company ||
        !payment_for_package ||
        !price
      ) {
        console.error("Missing required fields in payment update request.");
        return res.status(400).send({ message: "Missing required fields." });
      }

      const session = client.startSession();
      session.startTransaction();

      try {
        const filter = { email: email };
        const updateDoc = {
          $set: {
            "payment_info.transactionId": transactionId,
            "payment_info.payment_from_company": payment_from_company,
            "payment_info.payment_for_package": payment_for_package,
            "payment_info.date": new Date(),
            "payment_info.price": price,
            packages: payment_for_package, // Update the packages field
          },
          $inc: {
            limit: additionalLimit,
          },
        };

        const userResult = await usersCollection.updateOne(filter, updateDoc, {
          session,
        });

        if (userResult.modifiedCount !== 1) {
          throw new Error("Failed to update user payment info");
        }

        const payment = {
          hr_email: email,
          transactionId,
          payment_from_company,
          payment_for_package,
          date: new Date(),
          price,
          payment_status: true,
        };

        const paymentResult = await paymentCollection.insertOne(payment, {
          session,
        });

        if (!paymentResult.insertedId) {
          throw new Error("Failed to insert payment record");
        }

        await session.commitTransaction();
        res.send({ userResult, paymentResult });
      } catch (error) {
        console.error("Error processing payment update:", error);
        await session.abortTransaction();
        res.status(500).send({ message: error.message });
      } finally {
        session.endSession();
      }
    });

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
// MongoDB Ends Here

app.get("/", (req, res) => {
  res.send("Server is Running");
});
app.listen(port, () => {
  console.log(`Running Port is : ${port}`);
});
