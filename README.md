# Apex Rent Server

Express API for the Apex Rent car rental platform.

## Endpoints

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | `/auth/register` | No | Register user |
| POST | `/auth/login` | No | Login, sets JWT cookie |
| GET | `/auth/me` | Yes | Current user |
| POST | `/auth/logout` | No | Clear cookie |
| GET | `/auth/google` | No | Google OAuth redirect |
| GET | `/cars` | No | List cars (`?search=&type=`) |
| GET | `/cars/my` | Yes | User's listings |
| GET | `/cars/:id` | No | Single car |
| POST | `/cars` | Yes | Add car |
| PUT | `/cars/:id` | Yes | Update own car |
| DELETE | `/cars/:id` | Yes | Delete own car |
| GET | `/bookings/my` | Yes | User bookings |
| POST | `/bookings` | Yes | Create booking (`$inc` booking_count) |
| DELETE | `/bookings/:id` | Yes | Cancel booking |

## Environment Variables

Copy `.env.example` to `.env` and fill in values.

## Run Locally

```bash
npm install
npm run dev
```

Server runs on `http://localhost:5000`.
