const express = require('express');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const port = 3000;

app.use(express.json());
app.use(express.static('.'));

const dataFile = path.join(__dirname, 'posts.json');
const backupDir = path.join(__dirname, 'backups');
const visitsFile = path.join(__dirname, 'visits.json');

// Ensure backup directory exists
fs.mkdir(backupDir, { recursive: true }).catch(console.error);

let lastBackupTime = Date.now();
const BACKUP_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

async function ensureFileExists(filePath, defaultContent = '[]') {
  try {
    await fs.access(filePath);
  } catch (error) {
    if (error.code === 'ENOENT') {
      await fs.writeFile(filePath, defaultContent);
      console.log(`Created file: ${filePath}`);
    } else {
      throw error;
    }
  }
}

async function createBackup() {
  try {
    const files = await fs.readdir(backupDir);
    const backupFiles = files.filter(file => file.startsWith('posts') && file.endsWith('.json'));
    const nextBackupNumber = backupFiles.length + 1;
    const backupFile = path.join(backupDir, `posts${nextBackupNumber}.json`);
    
    await fs.copyFile(dataFile, backupFile);
    console.log(`Backup created: ${backupFile}`);
    lastBackupTime = Date.now();
    return backupFile;
  } catch (error) {
    console.error('Error creating backup:', error);
    throw error;
  }
}

async function checkAndCreateBackup() {
  const currentTime = Date.now();
  if (currentTime - lastBackupTime >= BACKUP_INTERVAL) {
    await createBackup();
  }
}

app.get('/api/posts', async (req, res) => {
  try {
    await ensureFileExists(dataFile);
    const data = await fs.readFile(dataFile, 'utf8');
    res.json(JSON.parse(data));
  } catch (error) {
    console.error('Error reading data:', error);
    res.status(500).json({ error: 'Error reading data' });
  }
});

app.post('/api/posts', async (req, res) => {
  try {
    await ensureFileExists(dataFile);
    await checkAndCreateBackup();

    let posts = [];
    const data = await fs.readFile(dataFile, 'utf8');
    posts = JSON.parse(data);

    const newPost = {
      id: Date.now(),
      title: req.body.title,
      content: req.body.content,
      createdAt: new Date().toISOString()
    };

    posts.push(newPost);
    await fs.writeFile(dataFile, JSON.stringify(posts, null, 2));
    await createBackup(); // Create a backup after adding a new post
    res.status(201).json(newPost);
  } catch (error) {
    console.error('Error saving data:', error);
    res.status(500).json({ error: 'Error saving data' });
  }
});

app.put('/api/posts/:id', async (req, res) => {
  try {
    await ensureFileExists(dataFile);
    const data = await fs.readFile(dataFile, 'utf8');
    let posts = JSON.parse(data);
    const postId = parseInt(req.params.id);
    const postIndex = posts.findIndex(post => post.id === postId);

    if (postIndex === -1) {
      return res.status(404).json({ error: 'Post not found' });
    }

    posts[postIndex] = {
      ...posts[postIndex],
      title: req.body.title,
      content: req.body.content,
      updatedAt: new Date().toISOString()
    };

    await fs.writeFile(dataFile, JSON.stringify(posts, null, 2));
    res.json(posts[postIndex]);
  } catch (error) {
    console.error('Error updating data:', error);
    res.status(500).json({ error: 'Error updating data' });
  }
});

app.delete('/api/posts/:id', async (req, res) => {
  try {
    await ensureFileExists(dataFile);
    const data = await fs.readFile(dataFile, 'utf8');
    let posts = JSON.parse(data);
    const postId = parseInt(req.params.id);
    const postIndex = posts.findIndex(post => post.id === postId);

    if (postIndex === -1) {
      return res.status(404).json({ error: 'Post not found' });
    }

    posts.splice(postIndex, 1);
    await fs.writeFile(dataFile, JSON.stringify(posts, null, 2));
    res.json({ message: 'Post successfully deleted' });
  } catch (error) {
    console.error('Error deleting data:', error);
    res.status(500).json({ error: 'Error deleting data' });
  }
});

app.get('/api/backups', async (req, res) => {
  try {
    const files = await fs.readdir(backupDir);
    const backups = await Promise.all(files.map(async (filename) => {
      const stats = await fs.stat(path.join(backupDir, filename));
      return {
        filename,
        createdAt: stats.birthtime
      };
    }));
    res.json({ backups });
  } catch (error) {
    console.error('Error reading backups:', error);
    res.status(500).json({ error: 'Error reading backups' });
  }
});

app.post('/api/backups', async (req, res) => {
  try {
    const backupFile = await createBackup();
    res.json({ message: 'Backup created successfully', backupFile });
  } catch (error) {
    console.error('Error creating backup:', error);
    res.status(500).json({ error: 'Error creating backup' });
  }
});

app.post('/api/backups/restore/:filename', async (req, res) => {
  try {
    const backupFile = path.join(backupDir, req.params.filename);
    
    // Check if the backup file exists
    await fs.access(backupFile);
    
    // Create a backup of the current state before restoring
    await createBackup();
    
    // Restore the backup
    await fs.copyFile(backupFile, dataFile);
    
    res.json({ message: 'Backup restored successfully' });
  } catch (error) {
    console.error('Error restoring backup:', error);
    if (error.code === 'ENOENT') {
      res.status(404).json({ error: 'Backup file not found' });
    } else {
      res.status(500).json({ error: 'Error restoring backup' });
    }
  }
});

app.delete('/api/backups/:filename', async (req, res) => {
  try {
    const backupFile = path.join(backupDir, req.params.filename);
    
    // Check if the backup file exists
    await fs.access(backupFile);
    
    // Delete the backup file
    await fs.unlink(backupFile);
    
    res.json({ message: 'Backup deleted successfully' });
  } catch (error) {
    console.error('Error deleting backup:', error);
    if (error.code === 'ENOENT') {
      res.status(404).json({ error: 'Backup file not found' });
    } else {
      res.status(500).json({ error: 'Error deleting backup' });
    }
  }
});

// New endpoint to record visits
app.post('/api/visit', async (req, res) => {
  try {
    await ensureFileExists(visitsFile, '[]');
    let visits = [];
    try {
      const visitsData = await fs.readFile(visitsFile, 'utf8');
      visits = JSON.parse(visitsData);
    } catch (parseError) {
      console.error('Error parsing visits data, resetting to empty array:', parseError);
    }

    const newVisit = {
      timestamp: new Date().toISOString(),
      ...req.body
    };

    visits.push(newVisit);
    await fs.writeFile(visitsFile, JSON.stringify(visits, null, 2));
    res.status(201).json({ message: 'Visit recorded successfully' });
  } catch (error) {
    console.error('Error recording visit:', error);
    res.status(500).json({ error: 'Error recording visit' });
  }
});

// New endpoint to get visit statistics
app.get('/api/visits', async (req, res) => {
  try {
    await ensureFileExists(visitsFile, '[]');
    let visits = [];
    try {
      const visitsData = await fs.readFile(visitsFile, 'utf8');
      visits = JSON.parse(visitsData);
    } catch (parseError) {
      console.error('Error parsing visits data, returning empty array:', parseError);
    }
    res.json({ totalVisits: visits.length, visits });
  } catch (error) {
    console.error('Error reading visits:', error);
    res.status(500).json({ error: 'Error reading visits' });
  }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
