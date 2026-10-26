-- Starter data. Runs only when the categories table is empty.
-- Sample items are flagged so you can remove them from the admin page.

INSERT INTO settings (key, value) VALUES
  ('tagline', 'Women''s clothing, picked by Aakriti.'),
  ('whatsapp', '')
ON CONFLICT (key) DO NOTHING;

INSERT INTO categories (id, name, position) VALUES
  ('lingerie',   'Lingerie',   0),
  ('layering',   'Layering',   1),
  ('topwear',    'Topwear',    2),
  ('bottomwear', 'Bottomwear', 3),
  ('dresses',    'Dresses',    4),
  ('nightwear',  'Nightwear',  5),
  ('activewear', 'Activewear', 6),
  ('footwear',   'Footwear',   7);

INSERT INTO items (id, name, category_id, price, is_sample, created_at) VALUES
  ('s1',  'Lace Balconette Bra Set',      'lingerie',   1499, true, now() - interval '1 day'),
  ('s2',  'Seamless Everyday Bralette',   'lingerie',    699, true, now() - interval '3 days'),
  ('s3',  'Longline Knit Cardigan',       'layering',   2299, true, now() - interval '5 days'),
  ('s4',  'Cropped Denim Jacket',         'layering',   2899, true, now() - interval '7 days'),
  ('s5',  'Ribbed Knit Top',              'topwear',     799, true, now() - interval '9 days'),
  ('s6',  'Puff-Sleeve Poplin Shirt',     'topwear',    1299, true, now() - interval '11 days'),
  ('s7',  'High-Rise Wide-Leg Trousers',  'bottomwear', 1899, true, now() - interval '13 days'),
  ('s8',  'Pleated Midi Skirt',           'bottomwear', 1599, true, now() - interval '15 days'),
  ('s9',  'Linen Midi Dress',             'dresses',    2490, true, now() - interval '17 days'),
  ('s10', 'Satin Slip Dress',             'dresses',    3100, true, now() - interval '19 days'),
  ('s11', 'Cotton Pyjama Set',            'nightwear',  1299, true, now() - interval '21 days'),
  ('s12', 'Modal Night Dress',            'nightwear',   999, true, now() - interval '23 days'),
  ('s13', 'Seamless Sports Bra',          'activewear', 1099, true, now() - interval '25 days'),
  ('s14', 'High-Waist Training Tights',   'activewear', 1499, true, now() - interval '27 days'),
  ('s15', 'Block-Heel Sandals',           'footwear',   2199, true, now() - interval '29 days'),
  ('s16', 'Everyday Canvas Sneakers',     'footwear',   1799, true, now() - interval '31 days');
