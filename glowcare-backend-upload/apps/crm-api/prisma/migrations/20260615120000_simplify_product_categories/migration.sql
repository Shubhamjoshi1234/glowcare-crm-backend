UPDATE "Order" SET "category" = 'serum'
WHERE lower("productName") LIKE '%serum%';

UPDATE "Order" SET "category" = 'moisturizer'
WHERE lower("productName") LIKE '%moisturizer%'
   OR lower("productName") LIKE '%moisturiser%';

UPDATE "Order" SET "category" = 'sunscreen'
WHERE lower("productName") LIKE '%sunscreen%'
   OR lower("productName") LIKE '%sun screen%'
   OR lower("productName") LIKE '%spf%';

UPDATE "Order" SET "category" = 'face wash'
WHERE lower("productName") LIKE '%cleanser%'
   OR lower("productName") LIKE '%face wash%'
   OR lower("productName") LIKE '%facewash%';

UPDATE "Order" SET "category" = 'makeup'
WHERE lower("productName") LIKE '%lip tint%'
   OR lower("productName") LIKE '%lipstick%'
   OR lower("productName") LIKE '%lip gloss%';

UPDATE "Order" SET "category" = 'night cream'
WHERE lower("productName") LIKE '%night%cream%';

UPDATE "Order" SET "category" = 'eye cream'
WHERE lower("productName") LIKE '%eye gel%'
   OR lower("productName") LIKE '%eye cream%';

UPDATE "Order" SET "category" = 'toner'
WHERE lower("productName") LIKE '%toner%';

UPDATE "Order" SET "category" = 'sunscreen'
WHERE lower("category") IN ('suncare', 'sun-care', 'sun care', 'sun screen');

UPDATE "Order" SET "category" = 'face wash'
WHERE lower("category") IN ('cleanser', 'facewash', 'face-wash');

UPDATE "Order" SET "category" = 'eye cream'
WHERE lower("category") IN ('eye-care', 'eye care');

UPDATE "Order" SET "category" = 'moisturizer'
WHERE lower("category") = 'moisturiser';

UPDATE "Segment"
SET "rulesJson" = json_set("rulesJson", '$.category_purchased', 'serum')
WHERE json_extract("rulesJson", '$.category_purchased') = 'skincare';

UPDATE "Segment"
SET "rulesJson" = json_set("rulesJson", '$.category_purchased', 'sunscreen')
WHERE json_extract("rulesJson", '$.category_purchased') IN ('suncare', 'sun-care', 'sun care');

UPDATE "Segment"
SET "rulesJson" = json_set("rulesJson", '$.category_purchased', 'face wash')
WHERE json_extract("rulesJson", '$.category_purchased') IN ('cleanser', 'facewash', 'face-wash');

UPDATE "Segment"
SET "rulesJson" = json_set("rulesJson", '$.category_purchased', 'eye cream')
WHERE json_extract("rulesJson", '$.category_purchased') IN ('eye-care', 'eye care');

UPDATE "Segment"
SET "name" = replace(replace(replace("name", 'skincare', 'serum'), 'skin care', 'serum'), 'Skin care', 'Serum')
WHERE lower("name") LIKE '%skincare%' OR lower("name") LIKE '%skin care%';
