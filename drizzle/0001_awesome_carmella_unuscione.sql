CREATE TABLE `dividends` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`market` enum('us','kr') NOT NULL,
	`ticker` varchar(20) NOT NULL,
	`tickerName` varchar(100),
	`dividendDate` timestamp NOT NULL,
	`amountUsd` decimal(18,6),
	`amountKrw` decimal(18,2),
	`taxWithheld` decimal(18,2) DEFAULT '0',
	`exchangeRate` decimal(10,4) DEFAULT '1',
	`memo` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `dividends_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `fund_records` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`fundType` enum('debt','extra_income','regular') NOT NULL,
	`recordType` enum('deposit','withdrawal','interest') NOT NULL,
	`amount` decimal(18,2) NOT NULL,
	`description` text,
	`recordDate` timestamp NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `fund_records_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `journal_entries` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`entryDate` timestamp NOT NULL,
	`title` varchar(200),
	`content` text NOT NULL,
	`tags` varchar(500),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `journal_entries_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `trades` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`market` enum('us','kr') NOT NULL,
	`tradeType` enum('buy','sell') NOT NULL,
	`ticker` varchar(20) NOT NULL,
	`tickerName` varchar(100),
	`quantity` decimal(18,6) NOT NULL,
	`price` decimal(18,6) NOT NULL,
	`exchangeRate` decimal(10,4) DEFAULT '1',
	`totalAmountKrw` decimal(20,2) NOT NULL,
	`commission` decimal(18,2) DEFAULT '0',
	`tax` decimal(18,2) DEFAULT '0',
	`secFee` decimal(18,6) DEFAULT '0',
	`memo` text,
	`tradeDate` timestamp NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `trades_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `user_settings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`usCommissionRate` decimal(8,4) DEFAULT '0.25',
	`krCommissionRate` decimal(8,4) DEFAULT '0.015',
	`secFeeRate` decimal(10,6) DEFAULT '0.0008',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `user_settings_id` PRIMARY KEY(`id`),
	CONSTRAINT `user_settings_userId_unique` UNIQUE(`userId`)
);
