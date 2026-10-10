require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const session = require('express-session');
const { RedisStore } = require('connect-redis');
const { createClient } = require('redis');
const bcrypt = require('bcryptjs');
const path = require('path');
const cloudinary = require('cloudinary').v2;
const multer = require('multer');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const isProduction = process.env.NODE_ENV === 'production';

    if (isProduction && !process.env.REDIS_URL) {
    throw new Error('Missing required configuration: REDIS_URL');
}

const redisClient = isProduction
    ? createClient({ url: process.env.REDIS_URL })
    : null;

if (redisClient) {
    redisClient.on('error', (err) => console.error('Redis Client Error:', err));
}
const requiredEnv = [
    'ADMIN_USERNAME',
    'ADMIN_PASSWORD_HASH',
    'SESSION_SECRET',
    'CLOUDINARY_CLOUD_NAME',
    'CLOUDINARY_API_KEY',
    'CLOUDINARY_API_SECRET'
];

for (const key of requiredEnv) {
    if (!process.env[key]) {
        throw new Error(`Missing required configuration: ${key}`);
    }
}

if (isProduction) {
    app.set('trust proxy', 1);
}

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

app.disable('x-powered-by');
app.use(helmet());
app.use(express.json({ limit: '10kb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.use('/api', rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 100,
    standardHeaders: 'draft-8',
    legacyHeaders: false
}));

app.use(session({
    store: isProduction
        ? new RedisStore({
            client: redisClient,
            prefix: 'puja-darshan:sess:'
        })
        : undefined,
    name: 'pd.sid',
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        secure: isProduction,
        sameSite: 'strict',
        maxAge: 2 * 60 * 60 * 1000
    }
}));

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 5,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Too many login attempts. Try again later.' }
});

function requireAdmin(req, res, next) {
    if (req.session && req.session.isAdmin === true) {
        return next();
    }

    return res.status(401).json({
        error: 'Authentication required.'
    });
}

const allowedMimes = new Set([
    'image/jpeg',
    'image/png',
    'image/webp',
    'video/mp4',
    'video/quicktime',
    'video/webm'
]);

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 50 * 1024 * 1024,
        files: 1
    },
    fileFilter: (req, file, cb) => {
        if (!allowedMimes.has(file.mimetype)) {
            return cb(new Error('Unsupported file type.'));
        }

        cb(null, true);
    }
});

app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        service: 'Puja Darshan API'
    });
});

app.post('/api/auth/login', loginLimiter, async (req, res, next) => {
    try {
        const { username, password } = req.body || {};

        if (
            typeof username !== 'string' ||
            typeof password !== 'string' ||
            username.length > 100 ||
            password.length > 200
        ) {
            return res.status(400).json({
                error: 'Invalid username or password.'
            });
        }

        const usernameMatches =
            username === process.env.ADMIN_USERNAME;

        const passwordMatches = await bcrypt.compare(
            password,
            process.env.ADMIN_PASSWORD_HASH
        );

        if (!usernameMatches || !passwordMatches) {
            return res.status(401).json({
                error: 'Invalid username or password.'
            });
        }

        req.session.regenerate(err => {
            if (err) return next(err);

            req.session.isAdmin = true;
            req.session.adminUsername = process.env.ADMIN_USERNAME;

            req.session.save(err => {
                if (err) return next(err);

                res.json({
                    success: true,
                    message: 'Login successful.'
                });
            });
        });
    } catch (error) {
        next(error);
    }
});

app.get('/api/auth/me', (req, res) => {
    if (!req.session || req.session.isAdmin !== true) {
        return res.status(401).json({
            authenticated: false
        });
    }

    res.json({
        authenticated: true,
        username: req.session.adminUsername
    });
});

app.post('/api/auth/logout', (req, res, next) => {
    if (!req.session) {
        return res.json({ success: true });
    }

    req.session.destroy(err => {
        if (err) return next(err);

        res.clearCookie('pd.sid', {
            httpOnly: true,
            secure: isProduction,
            sameSite: 'strict',
            path: '/'
        });

        res.json({
            success: true,
            message: 'Logged out.'
        });
    });
});

app.get('/api/admin/test', requireAdmin, (req, res) => {
    res.json({
        success: true,
        message: 'Admin authentication verified.'
    });
});

// Upload one image or video to Cloudinary.
app.post(
    '/api/admin/media',
    requireAdmin,
    upload.single('file'),
    async (req, res, next) => {
        try {
            if (!req.file) {
                return res.status(400).json({
                    error: 'Please select an image or video.'
                });
            }

            const result = await new Promise((resolve, reject) => {
                const stream = cloudinary.uploader.upload_stream(
                    {
                        folder: 'puja-darshan',
                        tags: ['puja-darshan-gallery'],
                        resource_type: 'auto'
                    },
                    (error, uploaded) => {
                        if (error) return reject(error);
                        resolve(uploaded);
                    }
                );

                stream.end(req.file.buffer);
            });

            res.status(201).json({
                success: true,
                media: {
                    public_id: result.public_id,
                    secure_url: result.secure_url,
                    resource_type: result.resource_type,
                    format: result.format,
                    original_filename: req.file.originalname,
                    created_at: result.created_at
                }
            });
        } catch (error) {
            next(error);
        }
    }
);

// List gallery items tagged by this application.
app.get('/api/admin/media', requireAdmin, async (req, res, next) => {
    try {
        const options = {
            max_results: 100,
            tags: true
        };

        const [images, videos] = await Promise.all([
            cloudinary.api.resources_by_tag(
                'puja-darshan-gallery',
                { ...options, resource_type: 'image' }
            ),
            cloudinary.api.resources_by_tag(
                'puja-darshan-gallery',
                { ...options, resource_type: 'video' }
            )
        ]);

        const media = [...images.resources, ...videos.resources]
            .sort((a, b) =>
                new Date(b.created_at) - new Date(a.created_at)
            )
            .map(item => ({
                public_id: item.public_id,
                secure_url: item.secure_url,
                resource_type: item.resource_type,
                format: item.format,
                created_at: item.created_at
            }));

        res.json({ success: true, media });
    } catch (error) {
        next(error);
    }
});

// Delete only tagged media belonging to this application's folder.
app.delete('/api/admin/media', requireAdmin, async (req, res, next) => {
    try {
        const { public_id, resource_type } = req.body || {};

        if (
            typeof public_id !== 'string' ||
            public_id.length === 0 ||
            public_id.length > 500 ||
            !['image', 'video'].includes(resource_type)
        ) {
            return res.status(400).json({
                error: 'Invalid media selection.'
            });
        }

        const asset = await cloudinary.api.resource(public_id, {
            resource_type,
            type: 'upload'
        });

        if (
            !Array.isArray(asset.tags) ||
            !asset.tags.includes('puja-darshan-gallery')
        ) {
            return res.status(403).json({
                error: 'This media is not managed by Puja Darshan.'
            });
        }

        const result = await cloudinary.uploader.destroy(public_id, {
            resource_type,
            invalidate: true
        });

        if (result.result !== 'ok') {
            return res.status(502).json({
                error: 'Cloudinary could not delete this media.'
            });
        }

        res.json({
            success: true,
            message: 'Media deleted successfully.'
        });
    } catch (error) {
        if (error.http_code === 404) {
            return res.status(404).json({
                error: 'Media not found.'
            });
        }

        next(error);
    }
});

// Handle upload and other request errors safely.
app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);

    if (err instanceof multer.MulterError) {
        const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;

        return res.status(status).json({
            error: err.code === 'LIMIT_FILE_SIZE'
                ? 'File size must not exceed 50 MB.'
                : 'Upload rejected. Please check the selected file.'
        });
    }

    if (err.message === 'Unsupported file type.') {
        return res.status(400).json({
            error: 'Allowed formats: JPG, PNG, WebP, MP4, MOV and WebM.'
        });
    }

    console.error('API request failed:', err);
    res.status(500).json({
        error: 'Internal server error.'
    });
});

app.use((req, res) => {
    res.status(404).json({
        error: 'Not found.'
    });
});


async function startServer() {
    try {
        if (redisClient) {
            await redisClient.connect();
            console.log('Redis connected successfully.');
        }

        app.listen(PORT, '0.0.0.0', () => {
            console.log(
                `Puja Darshan API running on port ${PORT}`
            );
        });
    } catch (err) {
        console.error('Failed to start server:', err);
        process.exit(1);
    }
}

startServer();
