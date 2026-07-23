import {
  bigint,
  decimal,
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// 거래 내역 (미국주식 + 국내주식 통합)
export const trades = mysqlTable("trades", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  market: mysqlEnum("market", ["us", "kr"]).notNull(), // us: 미국주식, kr: 국내주식
  tradeType: mysqlEnum("tradeType", ["buy", "sell"]).notNull(),
  ticker: varchar("ticker", { length: 20 }).notNull(), // 종목코드
  tickerName: varchar("tickerName", { length: 100 }), // 종목명
  quantity: decimal("quantity", { precision: 18, scale: 6 }).notNull(),
  price: decimal("price", { precision: 18, scale: 6 }).notNull(), // 단가 (미국주식: USD, 국내주식: KRW)
  exchangeRate: decimal("exchangeRate", { precision: 10, scale: 4 }).default("1"), // 환율 (국내주식은 1)
  totalAmountKrw: decimal("totalAmountKrw", { precision: 20, scale: 2 }).notNull(), // 원화 환산 총금액
  commission: decimal("commission", { precision: 18, scale: 2 }).default("0"), // 수수료 (원화)
  tax: decimal("tax", { precision: 18, scale: 2 }).default("0"), // 세금 (원화)
  secFee: decimal("secFee", { precision: 18, scale: 6 }).default("0"), // SEC Fee (원화, 미국주식 매도 시)
  broker: varchar("broker", { length: 50 }), // 증권사 (예: NH투자증권, 미래에셋증권, 키움증권 등)
  memo: text("memo"),
  tradeDate: timestamp("tradeDate").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Trade = typeof trades.$inferSelect;
export type InsertTrade = typeof trades.$inferInsert;

// 배당 기록
export const dividends = mysqlTable("dividends", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  market: mysqlEnum("market", ["us", "kr"]).notNull(),
  ticker: varchar("ticker", { length: 20 }).notNull(),
  tickerName: varchar("tickerName", { length: 100 }),
  dividendDate: timestamp("dividendDate").notNull(),
  amountUsd: decimal("amountUsd", { precision: 18, scale: 6 }), // 미국주식: USD 배당금
  amountKrw: decimal("amountKrw", { precision: 18, scale: 2 }), // 원화 배당금
  taxWithheld: decimal("taxWithheld", { precision: 18, scale: 2 }).default("0"), // 원천징수 세금
  exchangeRate: decimal("exchangeRate", { precision: 10, scale: 4 }).default("1"),
  memo: text("memo"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Dividend = typeof dividends.$inferSelect;
export type InsertDividend = typeof dividends.$inferInsert;

// 자금 관리 (빚투/부수입 등)
export const fundRecords = mysqlTable("fund_records", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  fundType: mysqlEnum("fundType", ["debt", "extra_income", "regular"]).notNull(),
  // debt: 빚투(레버리지), extra_income: 부수입 투자, regular: 일반
  recordType: mysqlEnum("recordType", ["deposit", "withdrawal", "interest", "extra_visit", "extra_mobile", "extra_board"]).notNull(),
  // deposit: 차입(빚투)/입금, withdrawal: 상환(빚투)/출금, interest: 이자(일반)
  // extra_visit: 방문진료, extra_mobile: 이동진료, extra_board: 등판위 (부수입 투자)
  amount: decimal("amount", { precision: 18, scale: 2 }).notNull(), // 원화
  description: text("description"),
  recordDate: timestamp("recordDate").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type FundRecord = typeof fundRecords.$inferSelect;
export type InsertFundRecord = typeof fundRecords.$inferInsert;

// 투자일기
export const journalEntries = mysqlTable("journal_entries", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  entryDate: timestamp("entryDate").notNull(),
  title: varchar("title", { length: 200 }),
  content: text("content").notNull(), // 마크다운
  tags: varchar("tags", { length: 500 }), // 쉼표 구분 태그
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type JournalEntry = typeof journalEntries.$inferSelect;
export type InsertJournalEntry = typeof journalEntries.$inferInsert;

// 사용자 설정
export const userSettings = mysqlTable("user_settings", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().unique(),
  // 미국주식 증권사별 수수료율 (%)
  commissionNH: decimal("commissionNH", { precision: 8, scale: 4 }).default("0.25"),       // NH투자증권
  commissionMiraeasset: decimal("commissionMiraeasset", { precision: 8, scale: 4 }).default("0.25"), // 미래에셋증권
  commissionKiwoom: decimal("commissionKiwoom", { precision: 8, scale: 4 }).default("0.25"),    // 키움증권
  commissionSamsung: decimal("commissionSamsung", { precision: 8, scale: 4 }).default("0.25"),   // 삼성증권
  commissionHantu: decimal("commissionHantu", { precision: 8, scale: 4 }).default("0.25"),     // 한국투자증권
  commissionKb: decimal("commissionKb", { precision: 8, scale: 4 }).default("0.25"),        // KB증권
  commissionToss: decimal("commissionToss", { precision: 8, scale: 4 }).default("0.25"),      // 토스증권
  // 국내주식 증권사별 수수료율 (%)
  commissionKrNH: decimal("commissionKrNH", { precision: 8, scale: 4 }).default("0.015"),
  commissionKrMiraeasset: decimal("commissionKrMiraeasset", { precision: 8, scale: 4 }).default("0.015"),
  commissionKrKiwoom: decimal("commissionKrKiwoom", { precision: 8, scale: 4 }).default("0.015"),
  commissionKrSamsung: decimal("commissionKrSamsung", { precision: 8, scale: 4 }).default("0.015"),
  commissionKrHantu: decimal("commissionKrHantu", { precision: 8, scale: 4 }).default("0.015"),
  commissionKrKb: decimal("commissionKrKb", { precision: 8, scale: 4 }).default("0.015"),
  commissionKrToss: decimal("commissionKrToss", { precision: 8, scale: 4 }).default("0.015"),
  // SEC Fee 요율 (%)
  secFeeRate: decimal("secFeeRate", { precision: 10, scale: 6 }).default("0.0008"),
  // 하위호환용 (기존 데이터)
  usCommissionRate: decimal("usCommissionRate", { precision: 8, scale: 4 }).default("0.25"),
  krCommissionRate: decimal("krCommissionRate", { precision: 8, scale: 4 }).default("0.015"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type UserSettings = typeof userSettings.$inferSelect;
export type InsertUserSettings = typeof userSettings.$inferInsert;
