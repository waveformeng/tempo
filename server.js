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

    // Invoice indexes
    await db.collection('invoices').createIndex({ clientId: 1 });
    await db.collection('invoices').createIndex({ jobId: 1 });
    await db.collection('invoices').createIndex({ createdAt: -1 });
    await db.collection('invoices').createIndex({ invoiceNumber: 1 }, { unique: true });

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

// ============== COMPANY ROUTES ==============

// Get company info (singleton)
app.get('/api/company', async (req, res) => {
  try {
    let company = await db.collection('company').findOne({});
    if (!company) {
      // Return empty company structure if none exists
      company = {
        name: '',
        contactName: '',
        contactEmail: '',
        contactPhone: '',
        street: '',
        city: '',
        state: '',
        zip: '',
        website: ''
      };
    }
    res.json(company);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update company info (upsert)
app.put('/api/company', async (req, res) => {
  try {
    const { name, contactName, contactEmail, contactPhone, street, city, state, zip, website } = req.body;
    const companyData = {
      name: name || '',
      contactName: contactName || '',
      contactEmail: contactEmail || '',
      contactPhone: contactPhone || '',
      street: street || '',
      city: city || '',
      state: state || '',
      zip: zip || '',
      website: website || '',
      updatedAt: new Date()
    };

    const result = await db.collection('company').findOneAndUpdate(
      {},
      { $set: companyData },
      { upsert: true, returnDocument: 'after' }
    );
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
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
    const { name, rate, street, city, state, zip } = req.body;
    if (!name || rate === undefined) {
      return res.status(400).json({ error: 'Name and rate are required' });
    }
    const result = await db.collection('clients').insertOne({
      name,
      rate: parseFloat(rate),
      street: street || '',
      city: city || '',
      state: state || '',
      zip: zip || '',
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
    const { name, rate, street, city, state, zip } = req.body;
    const result = await db.collection('clients').findOneAndUpdate(
      { _id: new ObjectId(req.params.id) },
      { $set: {
        name,
        rate: parseFloat(rate),
        street: street || '',
        city: city || '',
        state: state || '',
        zip: zip || '',
        updatedAt: new Date()
      } },
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
    const { name, clientId, jobNumber, contactName, contactEmail } = req.body;
    if (!name || !clientId) {
      return res.status(400).json({ error: 'Name and clientId are required' });
    }
    const result = await db.collection('jobs').insertOne({
      name,
      clientId,
      jobNumber: jobNumber || '',
      contactName: contactName || '',
      contactEmail: contactEmail || '',
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
    const { name, jobNumber, contactName, contactEmail } = req.body;
    const updateFields = { name, updatedAt: new Date() };
    if (jobNumber !== undefined) {
      updateFields.jobNumber = jobNumber;
    }
    if (contactName !== undefined) {
      updateFields.contactName = contactName;
    }
    if (contactEmail !== undefined) {
      updateFields.contactEmail = contactEmail;
    }
    const result = await db.collection('jobs').findOneAndUpdate(
      { _id: new ObjectId(req.params.id) },
      { $set: updateFields },
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

// ============== ADMIN ROUTES ==============

// Update all client rates to a specific value (one-time migration)
app.post('/api/admin/update-rates', async (req, res) => {
  try {
    const { rate } = req.body;
    if (!rate || typeof rate !== 'number') {
      return res.status(400).json({ error: 'Rate must be a number' });
    }

    const result = await db.collection('clients').updateMany(
      {},
      { $set: { rate: rate } }
    );

    res.json({
      message: `Updated ${result.modifiedCount} clients to $${rate}/hour`,
      modifiedCount: result.modifiedCount
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============== INVOICE ROUTES ==============

// Generate next invoice number
async function generateInvoiceNumber() {
  const year = new Date().getFullYear();
  const lastInvoice = await db.collection('invoices')
    .find({ invoiceNumber: { $regex: `^INV-${year}-` } })
    .sort({ invoiceNumber: -1 })
    .limit(1)
    .toArray();

  let nextNumber = 1;
  if (lastInvoice.length > 0) {
    const lastNumber = parseInt(lastInvoice[0].invoiceNumber.split('-')[2], 10);
    nextNumber = lastNumber + 1;
  }

  return `INV-${year}-${String(nextNumber).padStart(4, '0')}`;
}

// Get all invoices
app.get('/api/invoices', async (req, res) => {
  try {
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    if (req.query.clientId) filter.clientId = req.query.clientId;
    if (req.query.jobId) filter.jobId = req.query.jobId;

    const invoices = await db.collection('invoices')
      .find(filter)
      .sort({ createdAt: -1 })
      .toArray();
    res.json(invoices);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get single invoice
app.get('/api/invoices/:id', async (req, res) => {
  try {
    const invoice = await db.collection('invoices').findOne({ _id: new ObjectId(req.params.id) });
    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }
    res.json(invoice);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create invoice for a specific job
app.post('/api/invoices', async (req, res) => {
  try {
    const { clientId, jobId, startDate, endDate } = req.body;
    if (!clientId || !jobId || !startDate || !endDate) {
      return res.status(400).json({ error: 'clientId, jobId, startDate, and endDate are required' });
    }

    // Get client info
    const client = await db.collection('clients').findOne({ _id: new ObjectId(clientId) });
    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    // Get job info
    const job = await db.collection('jobs').findOne({ _id: new ObjectId(jobId) });
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    // Get company info
    const company = await db.collection('company').findOne({}) || {};

    // Get time entries for this job within the date range
    const start = new Date(startDate);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);

    const entries = await db.collection('timeEntries')
      .find({
        jobId: jobId,
        date: { $gte: start, $lte: end }
      })
      .sort({ date: 1 })
      .toArray();

    if (entries.length === 0) {
      return res.status(400).json({ error: 'No time entries found for this job in the specified date range' });
    }

    // Build line items from time entries
    const lineItems = entries.map(entry => ({
      date: entry.date,
      description: entry.description || 'Work performed',
      hours: entry.hours,
      amount: Math.round(entry.hours * client.rate * 100) / 100
    }));

    const totalHours = Math.round(lineItems.reduce((sum, item) => sum + item.hours, 0) * 100) / 100;
    const totalAmount = Math.round(lineItems.reduce((sum, item) => sum + item.amount, 0) * 100) / 100;

    const invoiceNumber = await generateInvoiceNumber();

    const invoice = {
      invoiceNumber,
      // Company (from) info
      companyName: company.name || '',
      companyContactName: company.contactName || '',
      companyContactEmail: company.contactEmail || '',
      companyContactPhone: company.contactPhone || '',
      companyStreet: company.street || '',
      companyCity: company.city || '',
      companyState: company.state || '',
      companyZip: company.zip || '',
      companyWebsite: company.website || '',
      // Client (bill to) info
      clientId,
      clientName: client.name,
      clientStreet: client.street || '',
      clientCity: client.city || '',
      clientState: client.state || '',
      clientZip: client.zip || '',
      clientRate: client.rate,
      // Job info
      jobId,
      jobName: job.name,
      jobNumber: job.jobNumber || '',
      contactName: job.contactName || '',
      contactEmail: job.contactEmail || '',
      // Invoice details
      startDate: start,
      endDate: end,
      status: 'unpaid',
      lineItems,
      totalHours,
      totalAmount,
      createdAt: new Date(),
      paidAt: null
    };

    const result = await db.collection('invoices').insertOne(invoice);
    const newInvoice = await db.collection('invoices').findOne({ _id: result.insertedId });
    res.status(201).json(newInvoice);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update invoice status
app.put('/api/invoices/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    if (!['paid', 'unpaid'].includes(status)) {
      return res.status(400).json({ error: 'Status must be "paid" or "unpaid"' });
    }

    const update = {
      status,
      updatedAt: new Date()
    };
    if (status === 'paid') {
      update.paidAt = new Date();
    } else {
      update.paidAt = null;
    }

    const result = await db.collection('invoices').findOneAndUpdate(
      { _id: new ObjectId(req.params.id) },
      { $set: update },
      { returnDocument: 'after' }
    );

    if (!result) {
      return res.status(404).json({ error: 'Invoice not found' });
    }
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete invoice
app.delete('/api/invoices/:id', async (req, res) => {
  try {
    const result = await db.collection('invoices').deleteOne({ _id: new ObjectId(req.params.id) });
    if (result.deletedCount === 0) {
      return res.status(404).json({ error: 'Invoice not found' });
    }
    res.json({ message: 'Invoice deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Generate printable HTML invoice
app.get('/api/invoices/:id/html', async (req, res) => {
  try {
    const invoice = await db.collection('invoices').findOne({ _id: new ObjectId(req.params.id) });
    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    const formatDate = (date) => {
      return new Date(date).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        timeZone: 'UTC'
      });
    };

    const formatCurrency = (amount) => {
      return '$' + amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    };

    const lineItemsHtml = invoice.lineItems.map(item => `
      <tr>
        <td>${formatDate(item.date)}</td>
        <td>${item.description}</td>
        <td class="right">${item.hours}h</td>
        <td class="right">${formatCurrency(item.amount)}</td>
      </tr>
    `).join('');

    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Invoice ${invoice.invoiceNumber}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      color: #1a1a1a;
      line-height: 1.6;
      padding: 40px;
      max-width: 800px;
      margin: 0 auto;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 40px;
      padding-bottom: 20px;
      border-bottom: 2px solid #f97316;
    }
    .company-info {
      max-width: 300px;
    }
    .company-info .sub {
      font-size: 13px;
      color: #666;
      margin-top: 2px;
    }
    .logo {
      font-size: 28px;
      font-weight: 700;
      line-height: 32px;
      color: #1a1a1a;
      margin-bottom: 16px;
    }
    .logo span { color: #f97316; }
    .invoice-info {
      text-align: right;
    }
    .invoice-number {
      font-size: 24px;
      font-weight: 600;
      color: #f97316;
    }
    .invoice-date {
      color: #666;
      margin-top: 4px;
    }
    .status {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      margin-top: 8px;
    }
    .status.paid { background: #dcfce7; color: #16a34a; }
    .status.unpaid { background: #fef3c7; color: #d97706; }
    .details {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 40px;
      margin-bottom: 40px;
    }
    .detail-section h3 {
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #666;
      margin-bottom: 8px;
    }
    .detail-section p {
      font-size: 16px;
      font-weight: 500;
    }
    .detail-section .sub {
      font-size: 14px;
      color: #666;
      font-weight: 400;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 24px;
    }
    th {
      text-align: left;
      padding: 12px 16px;
      background: #f5f5f5;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #666;
      border-bottom: 2px solid #e5e5e5;
    }
    th.right, td.right { text-align: right; }
    td {
      padding: 12px 16px;
      border-bottom: 1px solid #e5e5e5;
    }
    .totals {
      display: flex;
      justify-content: flex-end;
    }
    .totals-table {
      width: 280px;
    }
    .totals-table tr td {
      padding: 8px 16px;
    }
    .totals-table .label {
      color: #666;
    }
    .totals-table .total-row td {
      font-size: 18px;
      font-weight: 600;
      border-top: 2px solid #1a1a1a;
      padding-top: 12px;
    }
    .totals-table .total-row .amount {
      color: #f97316;
    }
    .footer {
      margin-top: 60px;
      padding-top: 20px;
      border-top: 1px solid #e5e5e5;
      text-align: center;
      color: #999;
      font-size: 13px;
    }
    @media print {
      body { padding: 20px; }
      .status { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="company-info">
      <div class="logo">${invoice.companyName || '<span>Generic Company</span>'}</div>
      ${invoice.companyContactName ? `<p class="sub">${invoice.companyContactName}</p>` : ''}
      ${invoice.companyStreet ? `<p class="sub">${invoice.companyStreet}</p>` : ''}
      ${(invoice.companyCity || invoice.companyState || invoice.companyZip) ? `<p class="sub">${[invoice.companyCity, invoice.companyState].filter(Boolean).join(', ')}${invoice.companyZip ? ' ' + invoice.companyZip : ''}</p>` : ''}
      ${invoice.companyContactPhone ? `<p class="sub">${invoice.companyContactPhone}</p>` : ''}
      ${invoice.companyContactEmail ? `<p class="sub">${invoice.companyContactEmail}</p>` : ''}
      ${invoice.companyWebsite ? `<p class="sub">${invoice.companyWebsite}</p>` : ''}
    </div>
    <div class="invoice-info">
      <div class="invoice-number">${invoice.invoiceNumber}</div>
      <div class="invoice-date">Issued: ${formatDate(invoice.createdAt)}</div>
      <span class="status ${invoice.status}">${invoice.status}</span>
    </div>
  </div>

  <div class="details">
    <div class="detail-section">
      <h3>Bill To</h3>
      <p>${invoice.clientName}</p>
      ${invoice.clientStreet ? `<p class="sub">${invoice.clientStreet}</p>` : ''}
      ${(invoice.clientCity || invoice.clientState || invoice.clientZip) ? `<p class="sub">${[invoice.clientCity, invoice.clientState].filter(Boolean).join(', ')}${invoice.clientZip ? ' ' + invoice.clientZip : ''}</p>` : ''}
    </div>
    <div class="detail-section">
      <h3>Job / Purchase Order</h3>
      <p>${invoice.jobName}${invoice.jobNumber ? ` <span class="sub"><b>${invoice.jobNumber}</b></span>` : ''}</p>
      ${invoice.contactName ? `<p class="sub">Attn: ${invoice.contactName}</p>` : ''}
      ${invoice.contactEmail ? `<p class="sub">${invoice.contactEmail}</p>` : ''}
      <p class="sub">Period: ${formatDate(invoice.startDate)} - ${formatDate(invoice.endDate)}</p>
      <p class="sub">Rate: ${formatCurrency(invoice.clientRate)}/hour</p>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Date</th>
        <th>Description</th>
        <th class="right">Hours</th>
        <th class="right">Amount</th>
      </tr>
    </thead>
    <tbody>
      ${lineItemsHtml}
    </tbody>
  </table>

  <div class="totals">
    <table class="totals-table">
      <tr>
        <td class="label">Total Hours</td>
        <td class="right">${invoice.totalHours}h</td>
      </tr>
      <tr>
        <td class="label">Rate</td>
        <td class="right">${formatCurrency(invoice.clientRate)}/hr</td>
      </tr>
      <tr class="total-row">
        <td>Total Due</td>
        <td class="right amount">${formatCurrency(invoice.totalAmount)}</td>
      </tr>
    </table>
  </div>

  <div class="footer">
    <p>Thank you for your business!</p>
  </div>
</body>
</html>
    `;

    res.setHeader('Content-Type', 'text/html');
    res.send(html);
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
