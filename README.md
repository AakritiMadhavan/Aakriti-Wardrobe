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

## Import photos from a webpage

In **Manage store**, choose **Import from link** (also available next to Add item).
Paste a public product-page URL, click **Find photos**, select up to ten photos,
and click **Use selected photos**. Review the name, category, price and photos in
the item editor, then save. The original webpage link is filled in automatically.
No item is created until you save it.

The importer reads HTML image tags, common lazy-loading attributes, responsive
images, social preview images and Product JSON-LD. Names are suggested from page
metadata; prices are suggested only when the source explicitly uses INR.
Some sites block automated requests or only load images with JavaScript. For
those sites, use manual photo upload. Preview links expire after 30 minutes;
scan again if necessary. Supported imported images are JPG, PNG, WebP and GIF,
up to 5 MB each, and the existing editor resizes them before saving.

Imports require admin login. The server validates and pins public DNS addresses,
rechecks redirects, and limits response sizes, request times and concurrency.
It does not use browser cookies or sign in to the source website.

Run the importer tests with `npm test`.

## Wishlist

Open **Wishlist** in the header to view it without logging in. Log in to add or edit entries. Save a title
and webpage link without needing a photo, category or price. Entries can be
edited, opened at their source, or removed.

**Add to wardrobe →** opens the item editor with the saved title and original
link. Add photos, a price and a category, then save. The wish is removed in the
same database transaction as item creation. Cancelling or a failed save leaves
it intact. Wishes persist in PostgreSQL. Viewing is public; adding, editing, removing and converting wishes requires admin login.

## Diary calendar

Log in and use the calendar icon in the header, or open `/#diary`. The calendar
is private to the admin and supports monthly and yearly views from 2023 through
the current year. Choose a past date or today to mark the diary entry **Not
written** (red), **In progress** (yellow), or **Written** (green). Future dates
are disabled. Statuses persist in PostgreSQL; no diary text is stored.

Stats show the selected year's completed entries and longest consecutive streak
of completed entries. The current day of the year appears only for the current
year. In-progress and not-written dates break a streak. Calendar dates and the
current day use Asia/Kolkata time.

The webpage importer also reads product galleries from embedded JSON hydration
data, including Nykaa and Next.js pages, plus inline background images and
additional lazy-load attributes. It does not execute remote JavaScript or bypass
website blocks. Up to 120 image candidates are offered, with up to ten selected
for an item.
