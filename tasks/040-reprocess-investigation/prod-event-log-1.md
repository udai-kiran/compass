# Production AI Event Log — Credit Card Statement Processing
**Date captured:** 2026-08-13  
**Server:** 192.168.2.228  
**Method:** `docker exec pennypilot-postgres psql -U compass compass -c "<SQL>"`

---

## Q1. Recent statement_parse and statement_summary AI events (last 30)

```sql
SELECT id, kind, status, title, account_id, ingestion_id, latency_ms, error, created_at
FROM ai_events
WHERE kind IN ('statement_parse', 'statement_summary')
ORDER BY created_at DESC
LIMIT 30;
```

```
                  id                  |       kind        | status |                                                  title                                                  |              account_id              |             ingestion_id             | latency_ms | error |          created_at
--------------------------------------+-------------------+--------+---------------------------------------------------------------------------------------------------------+--------------------------------------+--------------------------------------+------------+-------+-------------------------------
 c6d8a57b-02a3-4499-b33f-662ff8962c14 | statement_summary | ok     | Statement summary · Your PhonePe SBI Card SELECT Monthly Statement -Jul 2026                            | 2db16d4e-3e79-4478-b8e5-b6fb33aa5f82 | 718ed2b9-d49f-4bc8-9018-a9c293ea0061 |       2106 |       | 2026-08-13 02:24:17.938984+00
 1b076d5b-65bc-4366-a645-b19b103d3de6 | statement_parse   | ok     | Statement · Your PhonePe SBI Card SELECT Monthly Statement -Jul 2026                                    | 2db16d4e-3e79-4478-b8e5-b6fb33aa5f82 | 718ed2b9-d49f-4bc8-9018-a9c293ea0061 |      13241 |       | 2026-08-13 02:24:15.834696+00
 15c8729f-e8f1-42c3-9bc9-47bf95a722b7 | statement_summary | ok     | Statement summary · Fwd: Airtel Axis Bank Mastercard Credit Card Statement ending XX23 - July 2026      | 12d4b791-9b24-4f16-8999-f38063a88443 | e9268a84-10c2-4e7e-ae01-4cb1790c2196 |       3049 |       | 2026-08-13 02:23:54.298062+00
 f4064752-3888-4699-921d-5b44fe69f494 | statement_parse   | ok     | Statement · Fwd: Airtel Axis Bank Mastercard Credit Card Statement ending XX23 - July 2026              | 12d4b791-9b24-4f16-8999-f38063a88443 | e9268a84-10c2-4e7e-ae01-4cb1790c2196 |       4388 |       | 2026-08-13 02:23:51.249993+00
 98ab260c-b29e-46d8-b09f-f5a0365dc49e | statement_summary | ok     | Statement summary · Fwd: Your HDFC Bank - Diners Black Credit Card Statement - July-2026                | 12d4b791-9b24-4f16-8999-f38063a88443 | 119aec88-a2e4-4493-8a87-9990a78f5597 |       1348 |       | 2026-08-13 02:23:45.065414+00
 8b84d29e-27b1-4b77-9181-b3c879321590 | statement_summary | ok     | Statement summary · Airtel Axis Bank Mastercard Credit Card Statement ending XX23 - July 2026           | 12d4b791-9b24-4f16-8999-f38063a88443 | ff6349c0-4ea2-466a-bd20-db38986ed7e8 |       1906 |       | 2026-08-13 02:23:45.048533+00
 835b4b5d-8d34-45d3-bddd-84fc48f4a1e0 | statement_summary | ok     | Statement summary · Fwd: Your Axis Bank Rewards Credit Card ending XX86 - July 2026                     | 12d4b791-9b24-4f16-8999-f38063a88443 | a3877b70-2254-4a0b-b3eb-ad5933c08ce5 |       3354 |       | 2026-08-13 02:23:44.286262+00
 5e32dccb-e24c-4302-826c-f5522255dd36 | statement_parse   | ok     | Statement · Fwd: Your HDFC Bank - Diners Black Credit Card Statement - July-2026                        | 12d4b791-9b24-4f16-8999-f38063a88443 | 119aec88-a2e4-4493-8a87-9990a78f5597 |      14099 |       | 2026-08-13 02:23:43.718368+00
 afa56438-4506-400c-9abc-b9da3b76ba8d | statement_summary | ok     | Statement summary · Your Axis Bank Rewards Credit Card ending XX86 - July 2026                          | 12d4b791-9b24-4f16-8999-f38063a88443 | 71eb40fa-a1e4-4c66-810b-a5ba0dc3c61e |       3160 |       | 2026-08-13 02:23:43.256281+00
 328bd871-779f-4609-b9bd-be2595ebc9da | statement_parse   | ok     | Statement · Airtel Axis Bank Mastercard Credit Card Statement ending XX23 - July 2026                   | 12d4b791-9b24-4f16-8999-f38063a88443 | ff6349c0-4ea2-466a-bd20-db38986ed7e8 |       3491 |       | 2026-08-13 02:23:43.144023+00
 cb4adee2-3fa2-41ba-ad9f-66109ee82c98 | statement_parse   | ok     | Statement · Fwd: Your Axis Bank Rewards Credit Card ending XX86 - July 2026                             | 12d4b791-9b24-4f16-8999-f38063a88443 | a3877b70-2254-4a0b-b3eb-ad5933c08ce5 |       3505 |       | 2026-08-13 02:23:40.934158+00
 119adede-d01c-4a81-81c8-17129d296b01 | statement_parse   | ok     | Statement · Your Axis Bank Rewards Credit Card ending XX86 - July 2026                                  | 12d4b791-9b24-4f16-8999-f38063a88443 | 71eb40fa-a1e4-4c66-810b-a5ba0dc3c61e |       7016 |       | 2026-08-13 02:23:40.096352+00
 676a68a1-3aa4-4161-bbb2-a1803abf484d | statement_summary | ok     | Statement summary · Fwd: Your HDFC Bank - Swiggy HDFC Bank Credit Card Statement - July-2026            | 12d4b791-9b24-4f16-8999-f38063a88443 | 39350655-b6b6-4b96-b077-03c2ab78656f |       1866 |       | 2026-08-13 02:23:35.109904+00
 9f01c1db-e241-4613-be8c-fe1c810d1fed | statement_summary | ok     | Statement summary · Fwd: Your HDFC Bank - Tata Neu Infinity HDFC Bank Credit Card Statement - July-2026 | 12d4b791-9b24-4f16-8999-f38063a88443 | 60b7dc36-281b-4fdb-9869-62ee6b032ba6 |       3785 |       | 2026-08-13 02:23:33.775391+00
 5ab6735a-85e4-4fc0-8091-a75e8f055092 | statement_parse   | ok     | Statement · Fwd: Your HDFC Bank - Swiggy HDFC Bank Credit Card Statement - July-2026                    | 12d4b791-9b24-4f16-8999-f38063a88443 | 39350655-b6b6-4b96-b077-03c2ab78656f |       7879 |       | 2026-08-13 02:23:33.244463+00
 9dda60d1-67b7-4dc6-8f1d-9b07ed2794c7 | statement_parse   | ok     | Statement · Fwd: Your HDFC Bank - Tata Neu Infinity HDFC Bank Credit Card Statement - July-2026         | 12d4b791-9b24-4f16-8999-f38063a88443 | 60b7dc36-281b-4fdb-9869-62ee6b032ba6 |       4513 |       | 2026-08-13 02:23:29.986032+00
 b9326e79-391e-4118-b426-cdad2b07024f | statement_summary | ok     | Statement summary · Your PhonePe SBI Card SELECT Monthly Statement -Jul 2026                            | 2db16d4e-3e79-4478-b8e5-b6fb33aa5f82 | 718ed2b9-d49f-4bc8-9018-a9c293ea0061 |       2672 |       | 2026-08-12 18:14:31.388491+00
 ecee27f0-0f19-4403-8735-06fac2dcc043 | statement_parse   | ok     | Statement · Your PhonePe SBI Card SELECT Monthly Statement -Jul 2026                                    | 2db16d4e-3e79-4478-b8e5-b6fb33aa5f82 | 718ed2b9-d49f-4bc8-9018-a9c293ea0061 |      16218 |       | 2026-08-12 18:14:28.718158+00
 643acd25-4f83-419b-bb3e-216c2194d21f | statement_summary | ok     | Statement summary · Fwd: Your HDFC Bank - Diners Black Credit Card Statement - July-2026                | 12d4b791-9b24-4f16-8999-f38063a88443 | 119aec88-a2e4-4493-8a87-9990a78f5597 |       3860 |       | 2026-08-12 18:13:58.953440+00
 da4bf81d-8916-41bc-ad83-4622246d90e0 | statement_summary | ok     | Statement summary · Fwd: Airtel Axis Bank Mastercard Credit Card Statement ending XX23 - July 2026      | 12d4b791-9b24-4f16-8999-f38063a88443 | e9268a84-10c2-4e7e-ae01-4cb1790c2196 |       3864 |       | 2026-08-12 18:13:58.766948+00
 a46f9cff-7c47-45da-a681-c37ca6c8acb6 | statement_summary | ok     | Statement summary · Fwd: Your Axis Bank Rewards Credit Card ending XX86 - July 2026                     | 12d4b791-9b24-4f16-8999-f38063a88443 | a3877b70-2254-4a0b-b3eb-ad5933c08ce5 |       2295 |       | 2026-08-12 18:13:55.468271+00
 0d3fca50-14be-4678-9ec6-d2359273a86a | statement_parse   | ok     | Statement · Fwd: Your HDFC Bank - Diners Black Credit Card Statement - July-2026                        | 12d4b791-9b24-4f16-8999-f38063a88443 | 119aec88-a2e4-4493-8a87-9990a78f5597 |      13797 |       | 2026-08-12 18:13:55.095036+00
 f9b7a5dc-4476-4b47-88c8-3ac52867e443 | statement_parse   | ok     | Statement · Fwd: Airtel Axis Bank Mastercard Credit Card Statement ending XX23 - July 2026              | 12d4b791-9b24-4f16-8999-f38063a88443 | e9268a84-10c2-4e7e-ae01-4cb1790c2196 |       2696 |       | 2026-08-12 18:13:54.903460+00
 54034fe6-e9bd-4afc-86e2-dde933c65be0 | statement_parse   | ok     | Statement · Fwd: Your Axis Bank Rewards Credit Card ending XX86 - July 2026                             | 12d4b791-9b24-4f16-8999-f38063a88443 | a3877b70-2254-4a0b-b3eb-ad5933c08ce5 |       3768 |       | 2026-08-12 18:13:53.175182+00
 34487340-c251-4ecb-9b2a-af88d2bf63ed | statement_summary | ok     | Statement summary · Airtel Axis Bank Mastercard Credit Card Statement ending XX23 - July 2026           | 12d4b791-9b24-4f16-8999-f38063a88443 | ff6349c0-4ea2-466a-bd20-db38986ed7e8 |       1848 |       | 2026-08-12 18:13:52.385269+00
 a3ccb285-16ec-4143-8ba9-5785debaa9c7 | statement_parse   | ok     | Statement · Airtel Axis Bank Mastercard Credit Card Statement ending XX23 - July 2026                   | 12d4b791-9b24-4f16-8999-f38063a88443 | ff6349c0-4ea2-466a-bd20-db38986ed7e8 |       3750 |       | 2026-08-12 18:13:50.537890+00
 b632eee9-73f4-4b26-b4fa-0df5202dee8d | statement_summary | ok     | Statement summary · Your Axis Bank Rewards Credit Card ending XX86 - July 2026                          | 12d4b791-9b24-4f16-8999-f38063a88443 | 71eb40fa-a1e4-4c66-810b-a5ba0dc3c61e |       3495 |       | 2026-08-12 18:13:48.479501+00
 21ab3ff6-4d84-4b9e-9555-384fa2ac60d4 | statement_parse   | ok     | Statement · Your Axis Bank Rewards Credit Card ending XX86 - July 2026                                  | 12d4b791-9b24-4f16-8999-f38063a88443 | 71eb40fa-a1e4-4c66-810b-a5ba0dc3c61e |       2123 |       | 2026-08-12 18:13:44.985601+00
 d4b64714-f0f0-4faf-9d1a-e768ec7e1030 | statement_summary | ok     | Statement summary · Fwd: Your HDFC Bank - Swiggy HDFC Bank Credit Card Statement - July-2026            | 12d4b791-9b24-4f16-8999-f38063a88443 | 39350655-b6b6-4b96-b077-03c2ab78656f |       2939 |       | 2026-08-12 18:13:44.246201+00
 d63e9d97-d120-4e26-8709-28fff0239c7a | statement_summary | ok     | Statement summary · Fwd: Your HDFC Bank - Tata Neu Infinity HDFC Bank Credit Card Statement - July-2026 | 12d4b791-9b24-4f16-8999-f38063a88443 | 60b7dc36-281b-4fdb-9869-62ee6b032ba6 |       4312 |       | 2026-08-12 18:13:43.380501+00
(30 rows)
```

---

## Q2. Recent card_statement email_extract events (last 20)

```sql
SELECT e.id, e.kind, e.status, e.title, e.account_id, e.ingestion_id, e.error, e.created_at,
       i.classification, i.status as ingest_status
FROM ai_events e
LEFT JOIN email_ingestions i ON i.id = e.ingestion_id
WHERE e.kind = 'email_extract' AND i.classification = 'card_statement'
ORDER BY e.created_at DESC
LIMIT 20;
```

```
                  id                  |     kind      | status |                                             title                                              | account_id |             ingestion_id             | error |          created_at           | classification | ingest_status
--------------------------------------+---------------+--------+------------------------------------------------------------------------------------------------+------------+--------------------------------------+-------+-------------------------------+----------------+---------------
 30442f20-ac61-421e-ab2b-adfa09747639 | email_extract | ok     | Your PhonePe SBI Card SELECT Monthly Statement -Jul 2026                                       |            | 718ed2b9-d49f-4bc8-9018-a9c293ea0061 |       | 2026-08-13 02:24:01.463429+00 | card_statement | extracted
 4673af21-7f8c-4b89-b48d-010b5436f858 | email_extract | ok     | Your BPCL SBI Card OCTANE Monthly Statement -Jul 2026                                          |            | 2aebe253-6c33-4d81-bc61-df3bb45bb558 |       | 2026-08-13 02:23:57.925378+00 | card_statement | deferred
 5480b262-2bf3-43da-8600-91e12999def2 | email_extract | ok     | Fwd: Airtel Axis Bank Mastercard Credit Card Statement ending XX23 - July 2026                 |            | e9268a84-10c2-4e7e-ae01-4cb1790c2196 |       | 2026-08-13 02:23:46.272576+00 | card_statement | extracted
 64248d16-33f5-47ed-a86b-ac04fb75dd09 | email_extract | ok     | Airtel Axis Bank Mastercard Credit Card Statement ending XX23 - July 2026                      |            | ff6349c0-4ea2-466a-bd20-db38986ed7e8 |       | 2026-08-13 02:23:39.025191+00 | card_statement | extracted
 5aabe113-49c6-4e0f-aae6-ab732638041e | email_extract | ok     | Fwd: Your Axis Bank Rewards Credit Card ending XX86 - July 2026                                |            | a3877b70-2254-4a0b-b3eb-ad5933c08ce5 |       | 2026-08-13 02:23:36.701434+00 | card_statement | extracted
 06e36a75-57f1-48d6-8932-2aa4f6f21f60 | email_extract | ok     | Your Axis Bank Rewards Credit Card ending XX86 - July 2026                                     |            | 71eb40fa-a1e4-4c66-810b-a5ba0dc3c61e |       | 2026-08-13 02:23:32.350514+00 | card_statement | extracted
 c826d552-dead-4e90-be25-bc9b9a921762 | email_extract | ok     | Fwd: Amazon Pay ICICI Bank Credit Card Statement for the period June 19, 2026 to July 18, 2026 |            | 9ce9fa70-84ff-44f9-86b2-a32d3b6d9cac |       | 2026-08-13 02:23:28.152783+00 | card_statement | deferred
 7f04adfc-be32-4bec-bd73-9cbe3d2ac08a | email_extract | ok     | Fwd: Your HDFC Bank - Diners Black Credit Card Statement - July-2026                           |            | 119aec88-a2e4-4493-8a87-9990a78f5597 |       | 2026-08-13 02:23:27.735520+00 | card_statement | extracted
 07bb83f0-d252-49f6-bb89-37143ae6d886 | email_extract | ok     | Fwd: Your HDFC Bank - Swiggy HDFC Bank Credit Card Statement - July-2026                       |            | 39350655-b6b6-4b96-b077-03c2ab78656f |       | 2026-08-13 02:23:24.340624+00 | card_statement | extracted
 a6578f5d-ac14-4717-a51d-3e77510cfb23 | email_extract | ok     | Fwd: Your HDFC Bank - Tata Neu Infinity HDFC Bank Credit Card Statement - July-2026            |            | 60b7dc36-281b-4fdb-9869-62ee6b032ba6 |       | 2026-08-13 02:23:23.572753+00 | card_statement | extracted
 10599c56-a99f-4759-8e1f-a9882eb3b527 | email_extract | ok     | Your PhonePe SBI Card SELECT Monthly Statement -Jul 2026                                       |            | 718ed2b9-d49f-4bc8-9018-a9c293ea0061 |       | 2026-08-12 18:14:11.546285+00 | card_statement | extracted
 b080cb16-7077-42dc-bb53-d3e4617b5206 | email_extract | ok     | Your BPCL SBI Card OCTANE Monthly Statement -Jul 2026                                          |            | 2aebe253-6c33-4d81-bc61-df3bb45bb558 |       | 2026-08-12 18:14:07.376775+00 | card_statement | deferred
 e21bbba4-7668-423f-9528-05ce76306990 | email_extract | ok     | Fwd: Airtel Axis Bank Mastercard Credit Card Statement ending XX23 - July 2026                 |            | e9268a84-10c2-4e7e-ae01-4cb1790c2196 |       | 2026-08-12 18:13:51.598499+00 | card_statement | extracted
 0e106705-e704-437f-9dac-639948f4d413 | email_extract | ok     | Fwd: Your Axis Bank Rewards Credit Card ending XX86 - July 2026                                |            | a3877b70-2254-4a0b-b3eb-ad5933c08ce5 |       | 2026-08-12 18:13:48.817780+00 | card_statement | extracted
 8ad2dc9c-9037-4779-a2e5-49326b6dba95 | email_extract | ok     | Airtel Axis Bank Mastercard Credit Card Statement ending XX23 - July 2026                      |            | ff6349c0-4ea2-466a-bd20-db38986ed7e8 |       | 2026-08-12 18:13:46.131288+00 | card_statement | extracted
 6783fbe3-d0b8-4e21-ac07-be6a88c692c1 | email_extract | ok     | Your Axis Bank Rewards Credit Card ending XX86 - July 2026                                     |            | 71eb40fa-a1e4-4c66-810b-a5ba0dc3c61e |       | 2026-08-12 18:13:42.051768+00 | card_statement | extracted
 8841f302-768f-47dc-93f4-bd4e5a9e34f3 | email_extract | ok     | Fwd: Your HDFC Bank - Diners Black Credit Card Statement - July-2026                           |            | 119aec88-a2e4-4493-8a87-9990a78f5597 |       | 2026-08-12 18:13:40.641188+00 | card_statement | extracted
 ee77b180-6b4f-482c-8f48-4ed1e5165195 | email_extract | ok     | Fwd: Amazon Pay ICICI Bank Credit Card Statement for the period June 19, 2026 to July 18, 2026 |            | 9ce9fa70-84ff-44f9-86b2-a32d3b6d9cac |       | 2026-08-12 18:13:37.976775+00 | card_statement | deferred
 d3ae3638-d830-49e5-afa8-1e2b29cf3738 | email_extract | ok     | Fwd: Your HDFC Bank - Tata Neu Infinity HDFC Bank Credit Card Statement - July-2026            |            | 60b7dc36-281b-4fdb-9869-62ee6b032ba6 |       | 2026-08-12 18:13:33.488758+00 | card_statement | extracted
 9623d340-0892-4b0f-8bab-4bd71b886a36 | email_extract | ok     | Fwd: Your HDFC Bank - Swiggy HDFC Bank Credit Card Statement - July-2026                       |            | 39350655-b6b6-4b96-b077-03c2ab78656f |       | 2026-08-12 18:13:32.578765+00 | card_statement | extracted
(20 rows)
```

Note: `account_id` is NULL on ALL email_extract events (the column shows blank).

---

## Q3. Status distribution of card_statement ingestions

```sql
SELECT status, count(*) as cnt
FROM email_ingestions
WHERE classification = 'card_statement'
GROUP BY status;
```

```
  status   | cnt
-----------+-----
 deferred  |   2
 extracted |   8
(2 rows)
```

---

## Q4. statement_parse events with null account_id

```sql
SELECT id, title, status, error, created_at
FROM ai_events
WHERE kind = 'statement_parse' AND account_id IS NULL
ORDER BY created_at DESC
LIMIT 20;
```

```
 id | title | status | error | created_at
----+-------+--------+-------+------------
(0 rows)
```

All statement_parse events have a non-null account_id.

---

## Q5. Credit cards and whether they have statement passwords

```sql
SELECT a.id, a.name, a.institution,
       CASE WHEN cd.statement_password_enc IS NOT NULL THEN 'yes' ELSE 'no' END as has_password
FROM accounts a
LEFT JOIN card_details cd ON cd.account_id = a.id
WHERE a.type = 'credit_card' AND a.archived_at IS NULL
ORDER BY a.name;
```

```
                  id                  |           name            | institution | has_password
--------------------------------------+---------------------------+-------------+--------------
 ca9faaa6-9c6f-4fdb-a52e-74bf15b1b8dd | Amazon Pay                | ICICI       | yes
 6ddcd289-659c-4269-830c-666c601585e5 | Axis Airtel               | Axis        | yes
 fca1ea87-6936-4481-9342-26a3308b8926 | Diners Club International | HDFC        | yes
 0e4ee7f8-34f1-47ce-92c3-7d72a7a3c2ce | Rewards                   | Axis        | yes
 a19fd716-cb16-48bc-97e4-ec4985d08b07 | SBI OCTANE                | SBI         | yes
 2db16d4e-3e79-4478-b8e5-b6fb33aa5f82 | SBI PhonePe               | SBI         | yes
 12d4b791-9b24-4f16-8999-f38063a88443 | Swiggy                    | HDFC        | yes
 81e2d7cb-a629-41cd-8843-23e35d51278b | Tata Neu                  | HDFC        | yes
(8 rows)
```

All 8 active credit cards have statement passwords configured.

---

## Q6. Most recent statement_parse OK events — metadata + response preview

```sql
-- metadata only (response_raw is too large for column display):
SELECT id, title, account_id, created_at
FROM ai_events WHERE kind = 'statement_parse' AND status = 'ok'
ORDER BY created_at DESC LIMIT 3;
```

```
 1b076d5b-65bc-4366-a645-b19b103d3de6 | Statement · Your PhonePe SBI Card SELECT Monthly Statement -Jul 2026                       | 2db16d4e-3e79-4478-b8e5-b6fb33aa5f82 | 2026-08-13 02:24:15.834696+00
 f4064752-3888-4699-921d-5b44fe69f494 | Statement · Fwd: Airtel Axis Bank Mastercard Credit Card Statement ending XX23 - July 2026 | 12d4b791-9b24-4f16-8999-f38063a88443 | 2026-08-13 02:23:51.249993+00
 5e32dccb-e24c-4302-826c-f5522255dd36 | Statement · Fwd: Your HDFC Bank - Diners Black Credit Card Statement - July-2026           | 12d4b791-9b24-4f16-8999-f38063a88443 | 2026-08-13 02:23:43.718368+00
```

Response raw first non-whitespace content (SBI PhonePe statement, most recent):
```
{"id":"gen-1786587842-z5U9NPpyGaPH493IaZlZ","object":"chat.completion","created":1786587842,
"model":"openai/gpt-5.6-terra","provider":"OpenAI",...,"choices":[{"finish_reason":"tool_calls",
"message":{"tool_calls":[{"function":{"name":"record_statement_transactions","arguments":
"{\"transactions\":[{\"amount\":25689.99,\"direction\":\"credit\",\"date\":\"2026-06-30\",
\"counterparty\":\"PAYMENT RECEIVED\",...},...]}"}}]}}],"usage":{"prompt_tokens":10259,
"completion_tokens":2496,"total_tokens":12755,"cost":0.02776725,...}}
```

Model used: `openai/gpt-5.6-terra` via OpenRouter. Response shape: tool_calls → `record_statement_transactions`. Amounts are in float rupees in the LLM response (not yet paise at this stage).

---

## Q7. Most recent statement_parse ERROR events

```sql
SELECT id, title, account_id, left(request_context, 500) as req_preview, error, created_at
FROM ai_events
WHERE kind = 'statement_parse' AND status = 'error'
ORDER BY created_at DESC
LIMIT 5;
```

```
 id | title | account_id | req_preview | error | created_at
----+-------+------------+-------------+-------+------------
(0 rows)
```

No statement_parse errors exist at all in the database.

---

## Q8. Recent extracted_transactions from statement processing (last 20)

Note: The brief's query used `date` but the actual column is `occurred_at`. Corrected query:

```sql
SELECT id, suggested_account_id, status, counterparty, amount_paise, direction, occurred_at, intent, created_at
FROM extracted_transactions
WHERE ingestion_id IN (
  SELECT id FROM email_ingestions WHERE classification = 'card_statement'
)
ORDER BY created_at DESC
LIMIT 20;
```

```
                  id                  |         suggested_account_id         |  status  |             counterparty              | amount_paise | direction | occurred_at |  intent   |          created_at
--------------------------------------+--------------------------------------+----------+---------------------------------------+--------------+-----------+-------------+-----------+-------------------------------
 3cd935cf-fcb2-48d0-a34c-7d4208aa7e35 | 12d4b791-9b24-4f16-8999-f38063a88443 | pending  | PISTA HOUSE HYDERABAD                 |        47800 | debit     | 2026-06-25  |           | 2026-08-13 02:23:45.072398+00
 425178c8-cb6d-483a-a323-0dd0a557af99 | 12d4b791-9b24-4f16-8999-f38063a88443 | pending  | PISTA HOUSE HYDERABAD                 |        26900 | debit     | 2026-06-25  |           | 2026-08-13 02:23:45.072398+00
 395d5317-3a72-4a68-b672-f707f52cc405 | 12d4b791-9b24-4f16-8999-f38063a88443 | pending  | EMI YASHODA HEALTHCARE SERV HYDERABAD |      3413400 | debit     | 2026-06-20  |           | 2026-08-13 02:23:45.072398+00
 be5b2b00-ec3e-45cf-b263-043a59bed573 | 12d4b791-9b24-4f16-8999-f38063a88443 | pending  | VJ HYD 79 ATTAPUR RANGAREDDY          |       133600 | debit     | 2026-07-11  |           | 2026-08-13 02:23:45.072398+00
 41348825-d64a-4859-8112-bd9badce015b | 12d4b791-9b24-4f16-8999-f38063a88443 | pending  | EMI RS BROTHERS ATTAPUR HYDERABAD     |       519900 | debit     | 2026-07-08  |           | 2026-08-13 02:23:45.072398+00
 eb09a8df-ec3a-4b68-bdf7-ec800c59cf61 | 12d4b791-9b24-4f16-8999-f38063a88443 | pending  | URBANCLAP NOIDA                       |        59700 | debit     | 2026-07-09  |           | 2026-08-13 02:23:45.072398+00
 377abcbe-dbaa-4585-9423-6a102b025e2e | 12d4b791-9b24-4f16-8999-f38063a88443 | pending  | YASHODA OP PHARMACY HYDERABAD         |        52900 | debit     | 2026-06-20  |           | 2026-08-13 02:23:45.072398+00
 d6cc411d-0e47-430d-84dc-54333e13acc1 | 12d4b791-9b24-4f16-8999-f38063a88443 | pending  | VJ HYD 79 ATTAPUR RANGAREDDY          |        15000 | debit     | 2026-07-11  |           | 2026-08-13 02:23:45.072398+00
 1ba0e0a9-b5a2-411f-b46c-f90156f94410 | 12d4b791-9b24-4f16-8999-f38063a88443 | pending  | YASHODA OP PHARMACY HYDERABAD         |        54300 | debit     | 2026-06-27  |           | 2026-08-13 02:23:45.072398+00
 d31e36bf-1475-4970-962b-14ec05076e14 | 12d4b791-9b24-4f16-8999-f38063a88443 | pending  | APOLLO PHARMACIES LIMI HYDERABAD      |        47775 | debit     | 2026-07-11  |           | 2026-08-13 02:23:45.072398+00
 397c0852-19f5-4ad6-93aa-bf1b9092d00e | 12d4b791-9b24-4f16-8999-f38063a88443 | pending  | VJ HYD 57 HYDERGUDA RANGAREDDY        |         7200 | debit     | 2026-07-13  |           | 2026-08-13 02:23:45.072398+00
 6624cc50-f87b-49b1-b5d0-ecc9d7e63404 | 12d4b791-9b24-4f16-8999-f38063a88443 | pending  | YASHODA HEALTHCARE SERV HYDERABAD     |       120000 | debit     | 2026-07-17  |           | 2026-08-13 02:23:45.072398+00
 ca55c0a8-62c7-4ad3-9909-99a61f07183f | 12d4b791-9b24-4f16-8999-f38063a88443 | pending  | EMI YASHODA HEALTHCARE SERV HYDERABAD |      2416000 | debit     | 2026-07-17  |           | 2026-08-13 02:23:45.072398+00
 6e866283-c494-4571-93f6-ff426578502e | 12d4b791-9b24-4f16-8999-f38063a88443 | pending  | YASHODA OP PHARMACY HYDERABAD         |        57800 | debit     | 2026-07-17  |           | 2026-08-13 02:23:45.072398+00
 2a2642f3-6c4f-439b-8fa1-de6b6833e85b | 12d4b791-9b24-4f16-8999-f38063a88443 | pending  | KARACHI BAKERY RANGAREDDY             |       127300 | debit     | 2026-07-10  |           | 2026-08-13 02:23:45.072398+00
 70f0da60-7593-4abd-adbf-41310562782f | 2db16d4e-3e79-4478-b8e5-b6fb33aa5f82 | pending  | UPI-PhonePe                           |       209100 | debit     | 2026-07-06  |           | 2026-08-12 18:14:31.391902+00
 919fa009-4c97-4996-88ea-f69ae98b9e45 | 2db16d4e-3e79-4478-b8e5-b6fb33aa5f82 | accepted | PAYMENT RECEIVED                      |      2568999 | credit    | 2026-06-30  | repayment | 2026-08-12 18:14:31.391902+00
 981fd2e3-a83c-470b-bd75-062047d15d06 | 2db16d4e-3e79-4478-b8e5-b6fb33aa5f82 | pending  | UPI-PhonePe                           |       403805 | debit     | 2026-07-03  |           | 2026-08-12 18:14:31.391902+00
 0e7a9834-0a0b-4ea6-949c-1b7148adce04 | 2db16d4e-3e79-4478-b8e5-b6fb33aa5f82 | pending  | UPI-PhonePe                           |       285880 | debit     | 2026-07-06  |           | 2026-08-12 18:14:31.391902+00
 e5e84e90-11ba-4797-b7b7-04b2149f7015 | 2db16d4e-3e79-4478-b8e5-b6fb33aa5f82 | pending  | UPI-MUDHAVATA MOTHILAL                |        15000 | debit     | 2026-07-08  |           | 2026-08-12 18:14:31.391902+00
(20 rows)
```

---

## Supplementary queries

### Total extracted_transactions count for card_statement ingestions

```sql
SELECT count(*) FROM extracted_transactions
WHERE ingestion_id IN (SELECT id FROM email_ingestions WHERE classification = 'card_statement');
```
```
 count
-------
    76
(1 row)
```

### Status breakdown of those 76 extracted_transactions

```sql
SELECT status, count(*) FROM extracted_transactions
WHERE ingestion_id IN (SELECT id FROM email_ingestions WHERE classification = 'card_statement')
GROUP BY status;
```
```
  status  | count
----------+-------
 pending  |    56
 accepted |    20
(2 rows)
```

### extracted_transactions grouped by suggested_account

```sql
SELECT et.suggested_account_id, a.name, a.institution, count(*) as txn_count
FROM extracted_transactions et
LEFT JOIN accounts a ON a.id = et.suggested_account_id
WHERE et.ingestion_id IN (SELECT id FROM email_ingestions WHERE classification = 'card_statement')
GROUP BY et.suggested_account_id, a.name, a.institution
ORDER BY txn_count DESC;
```
```
         suggested_account_id         |    name     | institution | txn_count
--------------------------------------+-------------+-------------+-----------
 12d4b791-9b24-4f16-8999-f38063a88443 | Swiggy      | HDFC        |        47
 2db16d4e-3e79-4478-b8e5-b6fb33aa5f82 | SBI PhonePe | SBI         |        29
(2 rows)
```

### Transactions per ingestion_id

```sql
SELECT ingestion_id, count(*) FROM extracted_transactions
WHERE ingestion_id IN (SELECT id FROM email_ingestions WHERE classification = 'card_statement')
GROUP BY ingestion_id ORDER BY count DESC;
```
```
             ingestion_id             | count
--------------------------------------+-------
 119aec88-a2e4-4493-8a87-9990a78f5597 |    31
 718ed2b9-d49f-4bc8-9018-a9c293ea0061 |    29
 39350655-b6b6-4b96-b077-03c2ab78656f |     7
 60b7dc36-281b-4fdb-9869-62ee6b032ba6 |     4
 ff6349c0-4ea2-466a-bd20-db38986ed7e8 |     3
 71eb40fa-a1e4-4c66-810b-a5ba0dc3c61e |     2
(6 rows)
```

### Deferred ingestion details

```sql
SELECT id, subject, classification, status, error, created_at
FROM email_ingestions WHERE classification = 'card_statement' AND status = 'deferred';
```
```
                  id                  |                                            subject                                             | classification |  status  | error |          created_at
--------------------------------------+------------------------------------------------------------------------------------------------+----------------+----------+-------+-------------------------------
 9ce9fa70-84ff-44f9-86b2-a32d3b6d9cac | Fwd: Amazon Pay ICICI Bank Credit Card Statement for the period June 19, 2026 to July 18, 2026 | card_statement | deferred |       | 2026-08-12 05:19:20.193257+00
 2aebe253-6c33-4d81-bc61-df3bb45bb558 | Your BPCL SBI Card OCTANE Monthly Statement -Jul 2026                                          | card_statement | deferred |       | 2026-08-12 05:19:20.491347+00
(2 rows)
```

---

## Account ID cross-reference (from Q5)

| account_id | name | institution |
|---|---|---|
| ca9faaa6 | Amazon Pay | ICICI |
| 6ddcd289 | Axis Airtel | Axis |
| fca1ea87 | Diners Club International | HDFC |
| 0e4ee7f8 | Rewards | Axis |
| a19fd716 | SBI OCTANE | SBI |
| 2db16d4e | SBI PhonePe | SBI |
| 12d4b791 | Swiggy | HDFC |
| 81e2d7cb | Tata Neu | HDFC |

---

## Key observations

1. **statement_parse events exist and succeed** — no errors at all (Q4, Q7 both return 0 rows). All 30 rows in Q1 have status = 'ok'.

2. **account_id is always populated on statement_parse** — Q4 confirms zero null-account_id statement_parse events.

3. **Wrong account attribution for 5 of 8 cards**: The `account_id` on statement_parse events, and `suggested_account_id` on extracted_transactions, uses `12d4b791` (Swiggy HDFC) for statements belonging to at least 4 other cards:
   - Airtel Axis Mastercard (should be `6ddcd289`)
   - HDFC Diners Black (should be `fca1ea87`)
   - Axis Rewards (should be `0e4ee7f8`)
   - Tata Neu HDFC (should be `81e2d7cb`)
   Only SBI PhonePe (`2db16d4e`) is attributed correctly.

4. **Two ingestions permanently deferred** — Amazon Pay ICICI and SBI OCTANE statements both have `email_extract ok` but status = `deferred` with no error. Neither has any statement_parse events nor extracted_transactions. No statement_parse was attempted for them.

5. **Two ingestions extracted but produced 0 extracted_transactions** — `e9268a84` (Fwd: Airtel Axis) and `a3877b70` (Fwd: Axis Rewards) both have status = `extracted` and statement_parse events, but appear in no ingestion_id rows in extracted_transactions. Likely deduped against their non-Fwd counterparts (`ff6349c0` and `71eb40fa`).

6. **Password config** — all 8 active credit cards have `statement_password_enc` set. The two deferred ingestions (Amazon Pay ICICI and SBI OCTANE) have passwords configured, so deferral is not caused by missing passwords.

7. **76 total extracted_transactions** across 6 ingestions: 56 pending, 20 accepted. All are attributed to only 2 accounts (Swiggy HDFC: 47, SBI PhonePe: 29).

8. **Model used**: `openai/gpt-5.6-terra` via OpenRouter for statement parsing.
