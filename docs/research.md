# Pocket Hotel: research notes

Date: 2026-10-27. Marks: **[OK]** found in a source, **[?]** not sure, verify before building, **[GAP]** nothing found.
Only web search summaries were read so far; official pages (IRD, Immigration) were NOT opened. Treat every rule as "to verify with an accountant / IRD / Immigration".

## 1. Rules in Nepal that touch the software

### VAT and service charge
- 13% VAT and 10% service charge are the usual figures. [OK]
- Kathmandu District Court (2022) and the Department of Commerce said hotels/restaurants must NOT add VAT and service charge on top of the menu price; the menu price must already include them. [OK]
  Sources: [Kathmandu Post 2022](https://kathmandupost.com/money/2022/09/28/vat-service-charge-added-to-food-bill-deemed-illegal), [Kathmandu Post 2023](https://kathmandupost.com/money/2023/01/06/restaurants-adding-vat-on-menu-price-to-face-fines), [Republica](https://myrepublica.nagariknetwork.com/news/hotels-restaurants-prohibited-charging-extra-vat-and-service-charge)
- This ruling is about the menu/food. Whether ROOM rates are also quoted "all inclusive" or "+ taxes" in practice: [?]. Design: each price has a setting "tax included" or "added on top"; default for food = included.
- Service charge: mandatory since 2007, shared staff 68% / management 32% by agreement. [OK, older source] The app can show a service-charge pool per month for staff share. [Idea]
- Sept 2024: IRD gave a 10% VAT rebate for electronic payment (card, QR, mobile) at hotels, restaurants, bars. [OK] Source: [ShareSansar](https://www.sharesansar.com/newsdetail/ird-introduces-10-vat-rebate-for-electronic-payments-at-hotels-restaurants-and-bars-2024-09-10). Exact meaning (who gets the rebate, on what base, current status in 2026): [?]. Do not build until verified.

### IRD billing and approved software
- IRD runs CBMS (Central Billing Monitoring System). Large taxpayers and some sectors, hotels included, must connect billing software to it. [OK, thresholds conflict]
- Thresholds seen: turnover above Rs 10 crore (restaurants Rs 5 crore) in one source; Rs 20 crore from April 2026 in another. [?] Small lodges (5 to 60 rooms) are probably below this, but VAT-registered ones still must issue proper tax invoices. [?]
- IRD publishes a list of "verified" billing software. Whether a small hotel MUST use one: [?]. Sources: [Tally e-billing Nepal](https://help.tallysolutions.com/tally-e-billing-nepal-edition/), [country booklet](https://www.vatupdate.com/2026/09/20/nepal-e-invoicing-e-reporting-country-booklet/), [IRD verified list blog](https://subharambhasewa.digitalpress.blog/ird-verified-softwares-in-nepal/)
- Bill numbering: sequential, no gaps, no deletion, cancelled bills kept with reason, reprint marked "copy". This is standard Nepal tax-invoice practice. [?, confirm wording with IRD]
- **Decision:** MVP will be a *bill-keeping* tool with proper sequential numbering and PAN/VAT fields, and will say clearly "not IRD-approved software". CBMS connection is out of scope until the owner decides.

### Guest registration
- Nepal is moving to a digital foreign-guest system (Department of Immigration, "FNMIS" / NepaliPort tracking). Phase 1 Sept 2025 at 5-star Kathmandu hotels, later all star hotels, "gradually" guesthouses. Hotel must register a foreign guest if the guest has not self-registered in the immigration app. [OK, dates conflict] Sources: [Online Khabar](https://english.onlinekhabar.com/govt-to-track-foreigners-in-all-nepal-hotels.html), [Envoy](https://www.envoyglobal.com/news-alert/nepal-introduces-foreign-nationals-management-information-system/), [ANN](https://asianews.network/nepal-to-track-movement-of-all-foreign-visitors/)
- "C form" is an INDIAN form. A Nepal equivalent: [GAP]. Do not copy India's rules.
- Old police guest-register practice (paper register with name, address, ID, arrival, departure) is common; exact legal duty for small lodges: [?].
- **Decision:** capture the fields these systems ask for (name, nationality, passport no., visa type/expiry, arrival date, departure date, purpose, next destination, phone) and give a printable/CSV "foreign guest list". No automatic filing.

### Privacy of ID copies
- Nepal has the Privacy Act 2018 [?, not searched]. Safe design anyway: ask consent, store ID *number and details* by default, photo of ID optional and OFF by default, photos only on the device and in the hotel's own encrypted cloud space, delete option after a set time, access only for roles allowed, every view logged. [Design]

## 2. How a small hotel/lodge runs a day (from general knowledge, [?] for Nepal details, to confirm with 2 or 3 real owners)
1. Morning: housekeeping learns which rooms checked out, cleans, tells reception. Breakfast service.
2. Reception: check-out (bill = room nights + restaurant + laundry/extras, collect payment), then check-in of arrivals, from a paper register book / diary with a room chart drawn by hand.
3. Phone and WhatsApp bookings are written in the diary; advance often by eSewa/Khalti/bank transfer or cash.
4. Restaurant: waiter writes order slip, kitchen cooks, bill by hand or simple software, room guests "put on room".
5. Night: cash counting, day book, owner checks (or does not).
Typical pain: diary mistakes cause double booking; cash not written; discounts given by staff on their own; cancelled bills torn out; owner away cannot see anything.

## 3. Existing products and price
- Global: Little Hotelier about USD 89 to 109 per month, Hotelogix about USD 4 to 18 per room per month, others USD 50 to 300 per month for 10 to 30 rooms. [OK, vendor pages, rough] Sources: [Costbench](https://costbench.com/best/best-hotel-management-small-hotels/), [Hotelogix](https://www.hotelogix.com/blog/hotel-management-software-nepal), [Capterra](https://www.capterra.com/p/10022102/Hotel-PMS/)
- Listed for Nepal: KWHotel, Hotelogix, mycloud PMS, Oracle (too big), Sarvanam (Nepali PMS). Prices in Rs: [GAP], vendors ask for a quote. Source: [SoftwareSuggest Nepal](https://www.softwaresuggest.com/hotel-management-software/nepal)
- What they probably miss for a 10-room lodge: Nepali language and BS dates, works offline, phone-first, cheap enough, simple staff roles, eSewa/Khalti/Fonepay QR. [?, guess, needs checking by trying demos]

## 4. Room rates
- EP = room only. CP = room + breakfast. MAP = room + 2 meals (breakfast + dinner). AP = room + 3 meals. [OK] Source: [Travaly](https://mytravalyworldwide.zohodesk.in/portal/en/kb/articles/what-is-the-difference-between-cp-and-ep-meal-plans)
- Ideas to support: per room per night (default), extra person/extra bed charge, plan (EP/CP/MAP/AP) as an add-on price per person, seasonal prices (season = date range with different base price), long-stay discount, agent/OTA commission (percent, recorded per booking), foreigner vs Nepali price (common in Nepal, [?]).
- OTA (Booking.com, Agoda): no live channel manager. Plan: "OTA booking" is just a booking source with commission %; later maybe paste/CSV import of the OTA arrivals list. Their export format: [?].

## 5. Mistakes and fraud, and what the app does
Source for general patterns: [MySoftInn](https://page.mysoftinn.com/en/common-frauds-at-hotel-front-desk-how-to-prevent-them), [ChannelPlay](https://www.channelplay.in/post/prevent-hotel-fraud-with-mystery-shopping-audits). Double booking: [GAP] in sources, below is our own design.
| Problem | What the app does |
|---|---|
| Guest pays cash, stay never recorded | Room status "occupied" only through a check-in; owner report "occupied rooms vs bills" and "rooms cleaned but no stay" |
| Deleted or edited bills | Bills can never be deleted, only cancelled with reason and PIN of an allowed role; sequential numbers; audit log the owner can read |
| Staff gives discount alone | Discount above a limit needs manager PIN; discount report per staff |
| Cash goes missing | Each payment has a collector; day-end closing: expected cash vs counted cash, difference is shown and saved |
| Double booking | Server is the judge; two phones booking the same room and dates offline: first synced wins, the other becomes a "conflict" shown to the manager with one-tap move to another room |
| Room price changed secretly | Price change history in the audit log |
| Free (comp) stays | Comp needs a reason and manager approval, listed in reports |

## 6. Proposed versions
**MVP (v1)**
1. Hotel setup (name, address with province/district/municipality/ward, PAN/VAT, phone, logo, rooms and types).
2. Staff and roles, owner sets permissions (prices, reports, discount, cancel).
3. Rooms list and status; room chart (calendar) showing free/booked.
4. Booking (phone/walk-in/online-source), advance, cancel, no-show.
5. Check-in (guest and ID details), check-out with bill (room + food + extras), split payment, PDF/WhatsApp share.
6. Restaurant: menu, table or room order, kitchen screen, add to room bill.
7. Housekeeping: to-clean list, mark clean.
8. Money: payments by method, day book, day-end closing.
9. Basic reports: occupancy, income, staff-wise collection, unpaid, Excel export.
10. Nepali/English, BS/AD, offline + conflict-safe sync, audit log, account closing, admin page.
**Version 2:** printed kitchen slips, seasonal rates and meal plans, agent commission report, OTA CSV import, foreign guest list export, service-charge staff share, email bills (Gmail/Resend), laundry/other services, QR exact-amount payment.
**Skip for now:** live channel manager, door-lock link, IRD CBMS connection, payroll, stock/inventory of kitchen, online payment from guests, multi-hotel chains.

## 7. Defaults chosen (change if the owner says)
- Prices include 13% VAT + 10% service charge for food (court ruling); room tax setting per hotel.
- Check-in 12:00, check-out 11:00 (editable), per hotel.
- Foreign guest ID photo OFF by default.
- Kitchen = a screen first, printing later.
- Same stack as Pocket Pasal (React, TypeScript, Vite, Dexie, Hono, Cloudflare Workers + D1).

## 8. Questions that really change the design
1. Will the first hotels be VAT-registered and need a tax invoice with PAN, or simple receipts?
2. Do they charge foreigners and Nepalis different room prices?
3. Is there an owner we can show the mockup to (even one lodge) before building?
