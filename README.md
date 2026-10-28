# Aakriti's Wardrobe

A clothing catalogue website (no cart or checkout). Visitors browse a one-screen home page, category pages with optional subcategory filters, and a page for every item, each with its own link and a "You may also like" row. The owner logs in at `/#admin` to add items, upload photos, and manage categories and subcategories.

Built with Node.js and Express. Data and photos are stored in PostgreSQL, so the site works on hosts with temporary disks. Set up for Render (web hosting) and Neon (database).

## Deploy on Render and Neon

### 1. Create the database on Neon

1. Sign in at neon.tech and create a project (any name, pick the region closest to your visitors).
2. Click **Connect** on the project dashboard and copy the connection string. It looks like
   `postgres://user:password@ep-xxxx.region.aws.neon.tech/neondb?sslmode=require`.
3. Keep it handy for step 3. You do not need to create tables. The site creates them on first start.

### 2. Put the code on GitHub

Create a new repository and push this folder to it. `.env` is already ignored, so your secrets stay out of Git.

### 3. Create the web service on Render

**Option A, Blueprint (quickest):** In Render choose **New, Blueprint**, pick your repository, and Render reads `render.yaml`. When asked, paste your Neon connection string as `DATABASE_URL` and choose your admin password as `ADMIN_PASSWORD`. `SESSION_SECRET` is generated for you.

**Option B, by hand:** New, **Web Service**, pick your repository, then set:

| Setting | Value |
| --- | --- |
| Runtime | Node |
| Build command | `npm ci --omit=dev` |
| Start command | `node server.js` |
| Health check path | `/healthz` |

Environment variables:

| Name | Value |
| --- | --- |
| `DATABASE_URL` | Your Neon connection string |
| `ADMIN_PASSWORD` | A long password of your choice |
| `SESSION_SECRET` | A random string (see below) |
| `NODE_ENV` | `production` |
| `NODE_VERSION` | `22` |

Generate a secret with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.

### 4. Open the site

When the deploy finishes, open the `.onrender.com` address Render gives you. Log in at `/#admin`, then:

1. Under **Items**, click **Remove sample items** once you have added your own.
2. Under **Store details**, set the home page headline and your WhatsApp number (country code first, digits only) to show an "Enquire on WhatsApp" button on each item.
3. Under **Categories**, rename, reorder or add categories and their subcategories.
4. Assign items to a subcategory from the item editor; shoppers can filter that category page by subcategory.

### Good to know on the free plans

- **Render free web services sleep after 15 minutes without visits.** The first visit afterwards takes up to a minute to wake up. A paid Render instance stays awake.
- **Neon free databases pause when idle** and wake in about a second on the next request. The server allows time for this.
- **Neon free storage is 0.5 GB.** Photos are resized in the browser before upload (longest side 1500 px, roughly 150 to 400 KB each), so that holds well over a thousand photos.
- **Photos are stored in the database.** They survive redeploys and restarts, and a Neon backup includes them. There is no separate file storage to set up.
- To use your own domain, add it under the service's **Settings, Custom Domains** in Render.

## Pages and links

| Link | Page |
| --- | --- |
| `/` | Home |
| `/#c-dresses` | A category (the part after `c-` is the category id) |
| `/#p-<item id>` | One item. Use the **Copy link** button on the item page |
| `/#new` | New arrivals |
| `/#admin` | Admin login and store management |

## Run it on your computer

You need Node.js 18 or newer and a PostgreSQL database (a free Neon database works, or a local one).

```
npm install
cp .env.example .env     # set DATABASE_URL, ADMIN_PASSWORD, SESSION_SECRET
npm start
```

Open http://localhost:3000 and log in at http://localhost:3000/#admin.

For a local Postgres:

```
psql -U postgres -c "CREATE USER wardrobe WITH PASSWORD 'wardrobe';"
psql -U postgres -c "CREATE DATABASE wardrobe OWNER wardrobe;"
```

and use `DATABASE_URL=postgres://wardrobe:wardrobe@localhost:5432/wardrobe`.

On first start the server creates the tables from `db/schema.sql` and loads the eight categories plus 16 sample items from `db/seed.sql`.

## Database

| Table | Holds |
| --- | --- |
| `settings` | Home page headline and WhatsApp number |
| `categories` | Category id, name and menu order |
| `subcategories` | Subcategory id, parent category, name and order |
| `items` | Name, category, optional subcategory, price, created date, sample flag |
| `item_images` | Photos (image bytes and type) for each item, in order. The first is the cover |

Back up with `pg_dump "$DATABASE_URL" > backup.sql`.

## Files

```
server.js            Express server, API, admin login, photo storage and serving
db/schema.sql        Table definitions
db/seed.sql          Starter categories and sample items
public/index.html    Page shell
public/app.js        Storefront and admin interface
public/app.css       Styles (cream and pink theme, dark mode included)
render.yaml          Render Blueprint
.env.example         Settings template for running locally
```

## Changing the look

Colours are CSS variables at the top of `public/app.css` (`--bg`, `--accent`, `--hot`, and so on). The dark theme values sit in the two blocks below them.

## Security notes

- The admin password is checked on the server. The login cookie is signed, `HttpOnly`, and marked secure in production. Login attempts are limited to 8 per 15 minutes per visitor address.
- Uploaded files are accepted only if their contents are really JPG, PNG, WebP or GIF, whatever the file name says.
- Only visitors who are logged in can add, change or delete anything.
