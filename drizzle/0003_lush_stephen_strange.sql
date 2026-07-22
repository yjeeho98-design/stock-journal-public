ALTER TABLE `trades` ADD `broker` varchar(50);--> statement-breakpoint
ALTER TABLE `user_settings` ADD `commissionNH` decimal(8,4) DEFAULT '0.25';--> statement-breakpoint
ALTER TABLE `user_settings` ADD `commissionMiraeasset` decimal(8,4) DEFAULT '0.25';--> statement-breakpoint
ALTER TABLE `user_settings` ADD `commissionKiwoom` decimal(8,4) DEFAULT '0.25';--> statement-breakpoint
ALTER TABLE `user_settings` ADD `commissionSamsung` decimal(8,4) DEFAULT '0.25';--> statement-breakpoint
ALTER TABLE `user_settings` ADD `commissionHantu` decimal(8,4) DEFAULT '0.25';--> statement-breakpoint
ALTER TABLE `user_settings` ADD `commissionKb` decimal(8,4) DEFAULT '0.25';--> statement-breakpoint
ALTER TABLE `user_settings` ADD `commissionToss` decimal(8,4) DEFAULT '0.25';--> statement-breakpoint
ALTER TABLE `user_settings` ADD `commissionKrNH` decimal(8,4) DEFAULT '0.015';--> statement-breakpoint
ALTER TABLE `user_settings` ADD `commissionKrMiraeasset` decimal(8,4) DEFAULT '0.015';--> statement-breakpoint
ALTER TABLE `user_settings` ADD `commissionKrKiwoom` decimal(8,4) DEFAULT '0.015';--> statement-breakpoint
ALTER TABLE `user_settings` ADD `commissionKrSamsung` decimal(8,4) DEFAULT '0.015';--> statement-breakpoint
ALTER TABLE `user_settings` ADD `commissionKrHantu` decimal(8,4) DEFAULT '0.015';--> statement-breakpoint
ALTER TABLE `user_settings` ADD `commissionKrKb` decimal(8,4) DEFAULT '0.015';--> statement-breakpoint
ALTER TABLE `user_settings` ADD `commissionKrToss` decimal(8,4) DEFAULT '0.015';