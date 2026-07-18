-- Rename seed org from TechNova to Atllanta
UPDATE organizations SET name = 'Atllanta Pvt Ltd' WHERE name = 'TechNova Pvt Ltd';
UPDATE clients SET name = 'Atllanta Pvt Ltd' WHERE name = 'TechNova Pvt Ltd';
