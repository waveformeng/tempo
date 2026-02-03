# Tempo - Time Tracking Application

A simple, elegant time tracking application built with Node.js, Express, and MongoDB Atlas.

![Tempo Time Tracker](https://via.placeholder.com/800x400/0a0a0b/f97316?text=Tempo+Time+Tracker)

## Features

- **Client Management** - Add clients with their hourly rates
- **Job Management** - Create jobs under each client
- **Time Tracking** - Log time entries with cascading client/job selection
- **Dashboard** - View total hours, earnings, and breakdown by client
- **CRUD Operations** - Full create, read, update, delete for all entities

## Prerequisites

- Node.js 18+
- MongoDB Atlas account (free tier works great)

## Quick Start

### 1. Get Your MongoDB Connection String

1. Go to [MongoDB Atlas](https://cloud.mongodb.com)
2. Create a free cluster (or use an existing one)
3. Click "Connect" → "Connect your application"
4. Copy the connection string

### 2. Configure Environment

```bash
# Copy the example env file
cp .env.example .env

# Edit .env and add your MongoDB connection string
# Replace the MONGODB_URI value with your actual connection string
```

Your `.env` file should look like:
```
MONGODB_URI=mongodb+srv://youruser:yourpassword@yourcluster.xxxxx.mongodb.net/timetracker?retryWrites=true&w=majority
PORT=3000
```

### 3. Install & Run

```bash
# Install dependencies
npm install

# Start the server
npm start
```

### 4. Open the App

Navigate to `http://localhost:3000` in your browser.

## Usage

1. **Add a Client** - Go to Clients tab and add your first client with their hourly rate
2. **Create a Job** - Go to Jobs tab and create a job under that client
3. **Log Time** - Click "Log Time" to create time entries
4. **View Dashboard** - See your total hours and earnings on the Dashboard

## API Endpoints

### Clients
- `GET /api/clients` - List all clients
- `POST /api/clients` - Create client
- `PUT /api/clients/:id` - Update client
- `DELETE /api/clients/:id` - Delete client (cascades to jobs & entries)

### Jobs
- `GET /api/jobs` - List all jobs (optional `?clientId=` filter)
- `POST /api/jobs` - Create job
- `PUT /api/jobs/:id` - Update job
- `DELETE /api/jobs/:id` - Delete job (cascades to entries)

### Time Entries
- `GET /api/time-entries` - List all entries with client/job details
- `POST /api/time-entries` - Create entry
- `PUT /api/time-entries/:id` - Update entry
- `DELETE /api/time-entries/:id` - Delete entry

### Stats
- `GET /api/stats` - Get dashboard statistics

## Project Structure

```
time-tracker/
├── server.js          # Express server with API routes
├── public/
│   └── index.html     # Single-page frontend application
├── package.json       # Dependencies
├── .env.example       # Environment template
└── README.md          # This file
```

## Tech Stack

- **Backend**: Node.js, Express
- **Database**: MongoDB Atlas
- **Frontend**: Vanilla JavaScript, CSS
- **Fonts**: DM Sans, Fraunces

## License

MIT
