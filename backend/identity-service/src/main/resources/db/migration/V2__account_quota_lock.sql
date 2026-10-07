CREATE TABLE identity_limits (singleton INT NOT NULL PRIMARY KEY, CHECK(singleton=1)) ENGINE=InnoDB;
INSERT INTO identity_limits(singleton) VALUES(1);
