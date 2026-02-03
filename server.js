require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { MongoClient, ObjectId } = require('mongodb');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Basic Authentication
const AUTH_USER = process.env.AUTH_USER;
const AUTH_PASS = process.env.AUTH_PASS;

app.use((req, res, next) => {
  // Skip auth if credentials not configured (local development)
  if (!AUTH_USER || !AUTH_PASS) {
    return next();
  }

  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Time Tracker"');
    return res.status(401).send('Authentication required');
  }

  const base64Credentials = authHeader.split(' ')[1];
  const credentials = Buffer.from(base64Credentials, 'base64').toString('utf8');
  const [user, pass] = credentials.split(':');

  if (user === AUTH_USER && pass === AUTH_PASS) {
    next();
  } else {
    res.setHeader('WWW-Authenticate', 'Basic realm="Time Tracker"');
    return res.status(401).send('Invalid credentials');
  }
});

app.use(express.static(path.join(__dirname, 'public')));

// MongoDB Connection
let db;
let client;
const mongoUri = process.env.MONGODB_URI;

async function connectDB() {
  if (db) return db;

  try {
    client = new MongoClient(mongoUri);
    await client.connect();
    db = client.db('timetracker');
    console.log('Connected to MongoDB Atlas');

    // Create indexes for better query performance
    await db.collection('clients').createIndex({ name: 1 });
    await db.collection('jobs').createIndex({ clientId: 1 });
    await db.collection('timeEntries').createIndex({ clientId: 1, jobId: 1 });
    await db.collection('timeEntries').createIndex({ date: -1 });

    return db;
  } catch (error) {
    console.error('MongoDB connection error:', error.message);
    throw error;
  }
}

// Middleware to ensure DB connection for each request (serverless-friendly)
app.use(async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (error) {
    res.status(500).json({ error: 'Database connection failed' });
  }
});

// ============== CLIENT ROUTES ==============

// Get all clients
app.get('/api/clients', async (req, res) => {
  try {
    const clients = await db.collection('clients').find().sort({ name: 1 }).toArray();
    res.json(clients);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create client
app.post('/api/clients', async (req, res) => {
  try {
    const { name, rate } = req.body;
    if (!name || rate === undefined) {
      return res.status(400).json({ error: 'Name and rate are required' });
    }
    const result = await db.collection('clients').insertOne({
      name,
      rate: parseFloat(rate),
      createdAt: new Date()
    });
    const newClient = await db.collection('clients').findOne({ _id: result.insertedId });
    res.status(201).json(newClient);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update client
app.put('/api/clients/:id', async (req, res) => {
  try {
    const { name, rate } = req.body;
    const result = await db.collection('clients').findOneAndUpdate(
      { _id: new ObjectId(req.params.id) },
      { $set: { name, rate: parseFloat(rate), updatedAt: new Date() } },
      { returnDocument: 'after' }
    );
    if (!result) {
      return res.status(404).json({ error: 'Client not found' });
    }
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete client
app.delete('/api/clients/:id', async (req, res) => {
  try {
    const clientId = new ObjectId(req.params.id);
    // Delete associated jobs and time entries
    await db.collection('timeEntries').deleteMany({ clientId: clientId.toString() });
    await db.collection('jobs').deleteMany({ clientId: clientId.toString() });
    await db.collection('clients').deleteOne({ _id: clientId });
    res.json({ message: 'Client and associated data deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============== JOB ROUTES ==============

// Get all jobs (optionally filter by client)
app.get('/api/jobs', async (req, res) => {
  try {
    const filter = req.query.clientId ? { clientId: req.query.clientId } : {};
    const jobs = await db.collection('jobs').find(filter).sort({ name: 1 }).toArray();
    res.json(jobs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create job
app.post('/api/jobs', async (req, res) => {
  try {
    const { name, clientId } = req.body;
    if (!name || !clientId) {
      return res.status(400).json({ error: 'Name and clientId are required' });
    }
    const result = await db.collection('jobs').insertOne({
      name,
      clientId,
      createdAt: new Date()
    });
    const newJob = await db.collection('jobs').findOne({ _id: result.insertedId });
    res.status(201).json(newJob);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update job
app.put('/api/jobs/:id', async (req, res) => {
  try {
    const { name } = req.body;
    const result = await db.collection('jobs').findOneAndUpdate(
      { _id: new ObjectId(req.params.id) },
      { $set: { name, updatedAt: new Date() } },
      { returnDocument: 'after' }
    );
    if (!result) {
      return res.status(404).json({ error: 'Job not found' });
    }
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete job
app.delete('/api/jobs/:id', async (req, res) => {
  try {
    const jobId = new ObjectId(req.params.id);
    await db.collection('timeEntries').deleteMany({ jobId: jobId.toString() });
    await db.collection('jobs').deleteOne({ _id: jobId });
    res.json({ message: 'Job and associated time entries deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============== TIME ENTRY ROUTES ==============

// Get all time entries with client and job details
app.get('/api/time-entries', async (req, res) => {
  try {
    const entries = await db.collection('timeEntries').find().sort({ date: -1, createdAt: -1 }).toArray();
    
    // Enrich with client and job names
    const clients = await db.collection('clients').find().toArray();
    const jobs = await db.collection('jobs').find().toArray();
    
    const clientMap = Object.fromEntries(clients.map(c => [c._id.toString(), c]));
    const jobMap = Object.fromEntries(jobs.map(j => [j._id.toString(), j]));
    
    const enrichedEntries = entries.map(entry => ({
      ...entry,
      client: clientMap[entry.clientId],
      job: jobMap[entry.jobId]
    }));
    
    res.json(enrichedEntries);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create time entry
app.post('/api/time-entries', async (req, res) => {
  try {
    const { clientId, jobId, hours, date, description } = req.body;
    if (!clientId || !jobId || hours === undefined || !date) {
      return res.status(400).json({ error: 'clientId, jobId, hours, and date are required' });
    }
    const result = await db.collection('timeEntries').insertOne({
      clientId,
      jobId,
      hours: parseFloat(hours),
      date: new Date(date),
      description: description || '',
      createdAt: new Date()
    });
    const newEntry = await db.collection('timeEntries').findOne({ _id: result.insertedId });
    res.status(201).json(newEntry);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update time entry
app.put('/api/time-entries/:id', async (req, res) => {
  try {
    const { clientId, jobId, hours, date, description } = req.body;
    const result = await db.collection('timeEntries').findOneAndUpdate(
      { _id: new ObjectId(req.params.id) },
      { 
        $set: { 
          clientId, 
          jobId, 
          hours: parseFloat(hours), 
          date: new Date(date),
          description: description || '',
          updatedAt: new Date() 
        } 
      },
      { returnDocument: 'after' }
    );
    if (!result) {
      return res.status(404).json({ error: 'Time entry not found' });
    }
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete time entry
app.delete('/api/time-entries/:id', async (req, res) => {
  try {
    await db.collection('timeEntries').deleteOne({ _id: new ObjectId(req.params.id) });
    res.json({ message: 'Time entry deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============== DASHBOARD / STATS ==============

app.get('/api/stats', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    const clients = await db.collection('clients').find().toArray();
    const jobsList = await db.collection('jobs').find().toArray();

    // Build date filter if provided
    const dateFilter = {};
    if (startDate || endDate) {
      dateFilter.date = {};
      if (startDate) {
        dateFilter.date.$gte = new Date(startDate);
      }
      if (endDate) {
        // Set to end of day for endDate
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        dateFilter.date.$lte = end;
      }
    }

    const entries = await db.collection('timeEntries').find(dateFilter).toArray();

    let totalHours = 0;
    let totalEarnings = 0;
    const clientStats = {};

    const clientMap = Object.fromEntries(clients.map(c => [c._id.toString(), c]));
    const jobMap = Object.fromEntries(jobsList.map(j => [j._id.toString(), j]));

    entries.forEach(entry => {
      totalHours += entry.hours;
      const client = clientMap[entry.clientId];
      if (client) {
        const earnings = entry.hours * client.rate;
        totalEarnings += earnings;

        if (!clientStats[entry.clientId]) {
          clientStats[entry.clientId] = {
            clientId: entry.clientId,
            name: client.name,
            rate: client.rate,
            hours: 0,
            earnings: 0,
            jobs: {}
          };
        }
        clientStats[entry.clientId].hours += entry.hours;
        clientStats[entry.clientId].earnings += earnings;

        // Aggregate by job within client
        const job = jobMap[entry.jobId];
        const jobName = job ? job.name : 'Unknown';
        if (!clientStats[entry.clientId].jobs[entry.jobId]) {
          clientStats[entry.clientId].jobs[entry.jobId] = {
            jobId: entry.jobId,
            name: jobName,
            hours: 0,
            earnings: 0
          };
        }
        clientStats[entry.clientId].jobs[entry.jobId].hours += entry.hours;
        clientStats[entry.clientId].jobs[entry.jobId].earnings += earnings;
      }
    });

    // Convert jobs object to sorted array for each client, sort clients by earnings
    const byClient = Object.values(clientStats)
      .map(client => ({
        ...client,
        hours: Math.round(client.hours * 100) / 100,
        earnings: Math.round(client.earnings * 100) / 100,
        jobs: Object.values(client.jobs)
          .map(job => ({
            ...job,
            hours: Math.round(job.hours * 100) / 100,
            earnings: Math.round(job.earnings * 100) / 100
          }))
          .sort((a, b) => b.hours - a.hours) // Sort jobs by hours desc
      }))
      .sort((a, b) => b.earnings - a.earnings); // Sort clients by earnings desc

    res.json({
      totalHours: Math.round(totalHours * 100) / 100,
      totalEarnings: Math.round(totalEarnings * 100) / 100,
      clientCount: clients.length,
      entryCount: entries.length,
      byClient
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Start server (for local development)
if (process.env.NODE_ENV !== 'production') {
  connectDB().then(() => {
    app.listen(PORT, () => {
      console.log(`Server running at http://localhost:${PORT}`);
    });
  });
}

// Export for Vercel serverless
module.exports = app;
