# SEC CIK backfill match report (2026-06-04)

Targets: 414 companies with ticker and no sec_cik.
Threshold: name ratio >= 0.6 on suffix-stripped names.
Containment-only hits (shorter name fully inside the SEC title but
ratio below threshold) are routed to B3: affiliate-entity risk.

| bucket | count | disposition |
|---|---|---|
| B1 clean | 185 | in SQL, apply-ready |
| B2 share-class | 38 | in SQL, apply-ready (class noted) |
| B3-A token-equal | 1 | in SQL (labeled block), high confidence |
| B3-B judgment | 38 | decision table below |
| B3-C reject | 53 | zero token overlap, pure ticker collision |
| B4 unmatched | 99 | expected (foreign/private/delisted) |

B3 sub-classification: significant-token sets (lowercase, punctuation
stripped, corporate/legal stopwords and trailing '/ state' qualifiers
removed). A = sets equal. B = overlap but extra descriptor tokens on
one side (affiliate / same-brand-different-entity risk). C = zero
overlap (coincidental ticker).

## B3-A: token sets equal (now in the SQL as a labeled block)

| ticker | our name | SEC title | CIK |
|---|---|---|---|
| ALIT | Alight, Inc. | Alight, Inc. / Delaware | 1809104 |

## B3-B: needs judgment (our name | SEC title | shared | extra | suggestion)

| ticker | our name | SEC title | shared tokens | extra tokens | suggestion | UPDATE (commented) |
|---|---|---|---|---|---|---|
| AII | Integrity | American Integrity Insurance Group, Inc. | integrity | american insurance | reject: single shared brand token only | `-- UPDATE companies SET sec_cik = 2007587 WHERE id = '13c5db14-7289-41e3-b9b0-317df860de36' AND sec_cik IS NULL;` |
| ASBP | Aspire | Aspire Biopharma Holdings, Inc. | aspire | biopharma | reject: single shared brand token only | `-- UPDATE companies SET sec_cik = 1847345 WHERE id = '52ea6545-59f6-42a8-96ce-84039b3103d0' AND sec_cik IS NULL;` |
| AVK | Advent | ADVENT CONVERTIBLE & INCOME FUND | advent | convertible income | reject: single shared brand token only | `-- UPDATE companies SET sec_cik = 1219120 WHERE id = '78964d77-7ddb-4403-9d6f-8d2a60c08b73' AND sec_cik IS NULL;` |
| AXIN | Axiom | Axiom Intelligence Acquisition Corp 1 | axiom | 1 acquisition intelligence | reject: single shared brand token only | `-- UPDATE companies SET sec_cik = 2057030 WHERE id = 'bdc72ab0-6268-4502-ad5c-62486d2d32d5' AND sec_cik IS NULL;` |
| BCSF | Bain Capital | Bain Capital Specialty Finance, Inc. | bain capital | finance specialty | reject: extra descriptors look like an affiliate entity | `-- UPDATE companies SET sec_cik = 1655050 WHERE id = '14afa5db-ed1a-4b4e-a5dd-8c611bd0388e' AND sec_cik IS NULL;` |
| BCSF | Bain | Bain Capital Specialty Finance, Inc. | bain | capital finance specialty | reject: single shared brand token only | `-- UPDATE companies SET sec_cik = 1655050 WHERE id = 'd05ac3bf-2c8f-414b-9c4f-5c55f79c1945' AND sec_cik IS NULL;` |
| BDMD | Baird | Baird Medical Investment Holdings Ltd | baird | investment medical | reject: single shared brand token only | `-- UPDATE companies SET sec_cik = 1982444 WHERE id = '4da12221-0409-43be-bbb5-e17911a33f21' AND sec_cik IS NULL;` |
| BKD | Senior | Brookdale Senior Living Inc. | senior | brookdale living | reject: single shared brand token only | `-- UPDATE companies SET sec_cik = 1332349 WHERE id = '1db94c42-0cfe-44df-ac10-f21cbf05e8bf' AND sec_cik IS NULL;` |
| CAKE | Factory | CHEESECAKE FACTORY INC | factory | cheesecake | reject: single shared brand token only | `-- UPDATE companies SET sec_cik = 887596 WHERE id = '61ac7a1d-276e-4130-b3eb-903980c0928a' AND sec_cik IS NULL;` |
| CEPF | Cantor | Cantor Equity Partners IV, Inc. | cantor | equity iv partners | reject: single shared brand token only | `-- UPDATE companies SET sec_cik = 2034267 WHERE id = '85264810-cd53-4401-8cf2-5a8db40e2133' AND sec_cik IS NULL;` |
| CHYM | Chime | Chime Financial, Inc. | chime | financial | reject: single shared brand token only | `-- UPDATE companies SET sec_cik = 1795586 WHERE id = '3a638078-2bbe-4e58-9ba5-2c3b19305eaa' AND sec_cik IS NULL;` |
| DJT | Trump | Trump Media & Technology Group Corp. | trump | media technology | reject: single shared brand token only | `-- UPDATE companies SET sec_cik = 1849635 WHERE id = '3f0afef0-09c0-4fb9-8d7d-239fbf573840' AND sec_cik IS NULL;` |
| EBS | Emergent | Emergent BioSolutions Inc. | emergent | biosolutions | reject: single shared brand token only | `-- UPDATE companies SET sec_cik = 1367644 WHERE id = 'c52da7f7-a6b7-46e1-9826-e59f4d176514' AND sec_cik IS NULL;` |
| EEFT | Euronet | EURONET WORLDWIDE, INC. | euronet | worldwide | reject: single shared brand token only | `-- UPDATE companies SET sec_cik = 1029199 WHERE id = 'fb47ba65-ee1d-4ef8-8e45-f84a42f55c1f' AND sec_cik IS NULL;` |
| FDP | Del Monte | FRESH DEL MONTE PRODUCE INC | del monte | fresh produce | reject: two or more extra descriptors | `-- UPDATE companies SET sec_cik = 1047340 WHERE id = 'cf058641-6ace-48fd-88b6-ed40540d1fed' AND sec_cik IS NULL;` |
| GBTC | Bitcoin | Grayscale Bitcoin Trust ETF | bitcoin | etf grayscale | reject: single shared brand token only | `-- UPDATE companies SET sec_cik = 1588489 WHERE id = 'aec84192-5a04-477d-a370-fad6fd8e13a9' AND sec_cik IS NULL;` |
| GEMI | Gemini | Gemini Space Station, Inc. | gemini | space station | reject: single shared brand token only | `-- UPDATE companies SET sec_cik = 2055592 WHERE id = '8efcaad8-74a6-4db1-9c04-a08e6d932643' AND sec_cik IS NULL;` |
| GHY | PGIM | PGIM Global High Yield Fund, Inc. | pgim | global high yield | reject: single shared brand token only | `-- UPDATE companies SET sec_cik = 1554697 WHERE id = 'e2417d2f-55ec-4eb5-b3c9-4e433492477b' AND sec_cik IS NULL;` |
| GSRF | GSR | GSR IV Acquisition Corp. | gsr | acquisition iv | reject: single shared brand token only | `-- UPDATE companies SET sec_cik = 2072404 WHERE id = 'c1bd3af6-71fd-421c-8fd6-aeb2de829b0d' AND sec_cik IS NULL;` |
| HAVA | Harvard | Harvard Ave Acquisition Corp | harvard | acquisition ave | reject: single shared brand token only | `-- UPDATE companies SET sec_cik = 2042460 WHERE id = '9114e7a0-716c-484c-bbc2-245beef60f77' AND sec_cik IS NULL;` |
| HURN | Huron | Huron Consulting Group Inc. | huron | consulting | reject: single shared brand token only | `-- UPDATE companies SET sec_cik = 1289848 WHERE id = 'd837a0c3-2ed6-408f-8429-dec07fe262a9' AND sec_cik IS NULL;` |
| LEO | BNY | BNY MELLON STRATEGIC MUNICIPALS, INC. | bny | mellon municipals strategic | reject: single shared brand token only | `-- UPDATE companies SET sec_cik = 818972 WHERE id = '081a7baa-8d75-442a-a3e1-1fee155540aa' AND sec_cik IS NULL;` |
| LYRA | Lyra | Lyra Therapeutics, Inc. | lyra | therapeutics | reject: single shared brand token only | `-- UPDATE companies SET sec_cik = 1327273 WHERE id = '074aacf6-0a18-4025-aed7-c8a7991c426a' AND sec_cik IS NULL;` |
| MAKO | Mako | Mako Mining Corp. | mako | mining | reject: single shared brand token only | `-- UPDATE companies SET sec_cik = 1784930 WHERE id = '02050f94-b569-48c7-aa37-b6d9d3689072' AND sec_cik IS NULL;` |
| NAT | Nordic | NORDIC AMERICAN TANKERS Ltd | nordic | american tankers | reject: single shared brand token only | `-- UPDATE companies SET sec_cik = 1000177 WHERE id = '97a03ae5-cfca-4f4f-b3e1-9b74a4ed45f9' AND sec_cik IS NULL;` |
| OBT | Orange | Orange County Bancorp, Inc. /DE/ | orange | bancorp county | reject: single shared brand token only | `-- UPDATE companies SET sec_cik = 1754226 WHERE id = 'b25a5326-ef93-46f1-aa89-731375edcccc' AND sec_cik IS NULL;` |
| OCSL | Oaktree | Oaktree Specialty Lending Corp | oaktree | lending specialty | reject: single shared brand token only | `-- UPDATE companies SET sec_cik = 1414932 WHERE id = 'ad98ae4d-167f-4353-a623-c4dbcf83bc8e' AND sec_cik IS NULL;` |
| PDI | PIMCO | PIMCO Dynamic Income Fund | pimco | dynamic income | reject: single shared brand token only | `-- UPDATE companies SET sec_cik = 1510599 WHERE id = '27d85e3d-9ec8-481e-83bf-39203e866f91' AND sec_cik IS NULL;` |
| PTON | Peloton | PELOTON INTERACTIVE, INC. | peloton | interactive | reject: single shared brand token only | `-- UPDATE companies SET sec_cik = 1639825 WHERE id = '4b9e44f9-75cd-48f3-9e73-b80c9a94f7e8' AND sec_cik IS NULL;` |
| RGTI | Rigetti | Rigetti Computing, Inc. | rigetti | computing | reject: single shared brand token only | `-- UPDATE companies SET sec_cik = 1838359 WHERE id = '9cbc3c56-60f4-4f0d-ab2a-1f296e12cfae' AND sec_cik IS NULL;` |
| RNGR | Ranger | Ranger Energy Services, Inc. | ranger | energy services | reject: single shared brand token only | `-- UPDATE companies SET sec_cik = 1699039 WHERE id = '577abbfc-543f-4ec1-be3b-b06af381bf4a' AND sec_cik IS NULL;` |
| SEG | Seaport | Seaport Entertainment Group Inc. | seaport | entertainment | reject: single shared brand token only | `-- UPDATE companies SET sec_cik = 2009684 WHERE id = '3a8ab58e-f7ea-422b-931c-ff420b168b0c' AND sec_cik IS NULL;` |
| SKYE | Skye | Skye Bioscience, Inc. | skye | bioscience | reject: single shared brand token only | `-- UPDATE companies SET sec_cik = 1516551 WHERE id = 'edd754f5-93d4-413b-8158-ff590b3f7c64' AND sec_cik IS NULL;` |
| UP | UP | Wheels Up Experience Inc. | up | experience wheels | reject: single shared brand token only | `-- UPDATE companies SET sec_cik = 1819516 WHERE id = 'a883acc2-578f-41d7-858d-d4f3603645b5' AND sec_cik IS NULL;` |
| URBN | Urban Company | URBAN OUTFITTERS INC | urban | outfitters | reject: single shared brand token only | `-- UPDATE companies SET sec_cik = 912615 WHERE id = '8697c382-ccfc-4d19-9a1c-0edc02894bdb' AND sec_cik IS NULL;` |
| VOYG | Voyager | Voyager Technologies, Inc./DE | voyager | technologies | reject: single shared brand token only | `-- UPDATE companies SET sec_cik = 1788060 WHERE id = 'a988863a-72a9-4442-a245-ea0d6803a254' AND sec_cik IS NULL;` |
| XFLT | xAI | XAI Octagon Floating Rate & Alternative Income Trust | xai | alternative floating income octagon rate | reject: single shared brand token only | `-- UPDATE companies SET sec_cik = 1703079 WHERE id = 'd858429e-2b65-4d57-8b0b-96e7c4a8decc' AND sec_cik IS NULL;` |
| YMM | Alliance | Full Truck Alliance Co. Ltd. | alliance | full truck | reject: single shared brand token only | `-- UPDATE companies SET sec_cik = 1838413 WHERE id = 'f5a526f8-ff58-40c7-9b44-443b1ca192f1' AND sec_cik IS NULL;` |

## B3-C: rejected, zero significant-token overlap

| ticker | our name | SEC title |
|---|---|---|
| ACIW | ACIW | ACI WORLDWIDE, INC. |
| ACLS | Axcel | AXCELIS TECHNOLOGIES INC |
| AMTB | AMTB | Amerant Bancorp Inc. |
| ARCI | ArchiMed | Archimedes Tech SPAC Partners III Co. |
| ARCI | Archimed | Archimedes Tech SPAC Partners III Co. |
| ASPC | Alpha Capital | ASPAC III Acquisition Corp. |
| ASTH | Stran | Astrana Health, Inc. |
| BCG | BCG | Binah Capital Group, Inc. |
| BCG | Kingswood | Binah Capital Group, Inc. |
| BOC | OMAH | BOSTON OMAHA Corp |
| BYD | BYD | BOYD GAMING CORP |
| BYD | BYD Co. | BOYD GAMING CORP |
| CCO | CCO | Clear Channel Outdoor Holdings, Inc. |
| CDIX | AION | Cardiff Lexington Corp |
| CMTG | Claro | Claros Mortgage Trust, Inc. |
| COSO | Also | CoastalSouth Bancshares, Inc. |
| CVLT | MMV | COMMVAULT SYSTEMS INC |
| CWAN | CWAN | Clearwater Analytics Holdings, Inc. |
| EGO | EGO | ELDORADO GOLD CORP /FI |
| FERA | Fera | Fifth Era Acquisition Corp I |
| FSI | FSI | FLEXIBLE SOLUTIONS INTERNATIONAL INC |
| GBTC | SCA | Grayscale Bitcoin Trust ETF |
| GCT | GAC | GigaCloud Technology Inc |
| GETY | Neuberger | Getty Images Holdings, Inc. |
| GIC | GIC | GLOBAL INDUSTRIAL Co |
| GO | Go Inc. | Grocery Outlet Holding Corp. |
| GOVB | Verne | Gouverneur Bancorp, Inc./MD/ |
| GPI | GPI | GROUP 1 AUTOMOTIVE INC |
| GV | GV | Visionary Holdings Inc. |
| HG | Hg | Hamilton Insurance Group, Ltd. |
| JWSMF | AWS | Jaws Mustang Acquisition Corp |
| LGDTF | LGDTF | Liberty Gold Corp. /CAN |
| LOT | L Catterton | Lotus Technology Inc. |
| MCFT | Craft | MasterCraft Boat Holdings, Inc. |
| MIR | Mir | Mirion Technologies, Inc. |
| MTA | MTA | Metalla Royalty & Streaming Ltd. |
| MX | Magna | MAGNACHIP SEMICONDUCTOR Corp |
| NCLH | NCLH | Norwegian Cruise Line Holdings Ltd. |
| NOEM | O2 | CO2 Energy Transition Corp. |
| NTCL | TCL | NetClass Technology Inc |
| PAM | PAM | Pampa Energy Inc. |
| PLAB | Otro | PHOTRONICS INC |
| RGTI | Gett | Rigetti Computing, Inc. |
| RVLGF | RVLGF | Revival Gold Inc. |
| SKE | SKE | Skeena Resources Ltd |
| SMTK | TKE | SmartKem, Inc. |
| SRZN | Roze | Surrozen, Inc./DE |
| STG | STG | Sunlands Technology Group |
| STVN | NATO | Stevanato Group S.p.A. |
| TBPH | Avance | Theravance Biopharma, Inc. |
| TSM | TSMC | TAIWAN SEMICONDUCTOR MANUFACTURING CO LTD |
| UEC | UEC | URANIUM ENERGY CORP |
| XRN | Hiro | Chiron Real Estate Inc. |

## B4 unmatched tickers

002415.SZ, 2223.SR, 4565.T, 600941.SS, 688408.SS, 7203.T, ACTD, ASPU, AXAC, BKMP, BRYN, BSEG, BXRXQ, CFLT, CGPOWER.NS, CHFW, CHX, COFORGE.NS, CTRA, CXBS, CYBR, ECDD, ECLP, ELYS, EMPO, ENV, EP PR C, ESTRF, EVRC, EWCZ, FFZY, FL, FNA, GBNHF, GRCO, GRCU, GYPHQ, HBI, HES, HOLX, ICBT, INFN, IPO-ELLT, IVCA, JNPR, KKC.AX, KMAR.OL, KPITTECH.NS, KVIL, KVSD, LLNXF, LNBY, MFD, MPIR, MRK1T.TL, NCRE, NKLAQ, OSCI, PHARM.AS, PIEJF, PLTT, PNST, POLICYBZR.NS, POLYCAB.NS, PORT, PSCO, PWSC, RBSY, RCM, SAVEQ, SFLM, SHELL.AS, SIX, SLCO, SN.L, SNST, SPR, SQCF, SRCH, SSNLF, TGNA, TNEN, TOWN, TRTN PR A, UATG, USPS, VAYK, VCSA, VTXB, WIRE, WSSE, X, XCPCX
