# Mahabir Electricals — WhatsApp Enquiry Automation & CRM

Capture WhatsApp product enquiries, extract electrical products with AI from handwritten slips, generate quotations, send them back, and run automations — all in one dashboard.

Built for **Mahabir Electricals** — electrical wholesalers and retailers across India.

---

## Tech Stack (Migrated)

| Layer | Technology |
|---|---|
| Frontend | Next.js 14 (App Router, TypeScript) |
| Backend | Node.js + Express (TypeScript) |
| ORM | Prisma |
| Database | PostgreSQL |
| Cache / Queue | Redis + BullMQ |
| File Storage | AWS S3 (sdk v3) |
| OCR | Google Cloud Vision API |
| LLM | Google Gemini 2.5 Flash |
| WhatsApp | MSG91 WhatsApp Business API |
| Quotation Render | Puppeteer (HTML → PNG) |
| Auth | JWT (httpOnly cookies) |
| Real-time | Socket.io |
| Styling | Tailwind CSS + shadcn/ui |

---

## Demo login

| Email | Password |
| --- | --- |
| `admin@example.com` | `Admin@1234` |

---

## Getting Started

### 1. Spin up Database & Redis (Docker Compose)
We have provided a `docker-compose.yml` file in the root directory. To run PostgreSQL (port 5433) and Redis (port 6379):
```bash
docker compose up -d
```

### 2. Configure Environment Variables
Copy the values from the prompt into a `.env` file at the root, and also copy it to `backend/.env`. Ensure `DATABASE_URL` is pointing to port `5433`:
```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/whatsapp_crm
REDIS_URL=redis://localhost:6379
```

### 3. Run Database Migrations & Seeding
Install backend dependencies, execute the Prisma migration, and seed the initial Admin user and products:
```bash
cd backend
npm install
npx prisma migrate dev --name init
npx prisma db seed
```

### 4. Run the Apps Locally
Launch both servers in development mode:

**Backend:**
```bash
cd backend
npm run dev
```

**Frontend:**
```bash
cd frontend
npm run dev
```

The frontend will run on `http://localhost:3000` and automatically proxy API calls to the Express backend on `http://localhost:4000`.
