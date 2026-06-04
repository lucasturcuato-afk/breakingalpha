# SEC CIK backfill match report (2026-06-04)

Targets: 414 companies with ticker and no sec_cik.
Threshold: name ratio >= 0.6 on suffix-stripped names.
Containment-only hits (shorter name fully inside the SEC title but
ratio below threshold) are routed to B3: affiliate-entity risk.

| bucket | count | disposition |
|---|---|---|
| B1 clean | 185 | in SQL, apply-ready |
| B2 share-class | 38 | in SQL, apply-ready (class noted) |
| B3 suspect | 92 | EXCLUDED, adjudicate below |
| B4 unmatched | 99 | expected (foreign/private/delisted) |

## B3 suspects (full list, our name vs SEC title)

| ticker | our name | SEC candidate(s) | ratio | reason |
|---|---|---|---|---|
| ACIW | ACIW | CIK 935036 'ACI WORLDWIDE, INC.' (ACIW) | 0.47 | SEC title disagrees with our name |
| ACLS | Axcel | CIK 1113232 'AXCELIS TECHNOLOGIES INC' (ACLS) | 0.40 | SEC title disagrees with our name |
| AII | Integrity | CIK 2007587 'American Integrity Insurance Group, Inc.' (AII) | 0.49 | SEC title disagrees with our name |
| ALIT | Alight, Inc. | CIK 1809104 'Alight, Inc. / Delaware' (ALIT) | 0.57 | SEC title disagrees with our name |
| AMTB | AMTB | CIK 1734342 'Amerant Bancorp Inc.' (AMTB) | 0.42 | SEC title disagrees with our name |
| ARCI | ArchiMed | CIK 2083910 'Archimedes Tech SPAC Partners III Co.' (ARCI) | 0.39 | SEC title disagrees with our name |
| ARCI | Archimed | CIK 2083910 'Archimedes Tech SPAC Partners III Co.' (ARCI) | 0.39 | SEC title disagrees with our name |
| ASBP | Aspire | CIK 1847345 'Aspire Biopharma Holdings, Inc.' (ASBP) | 0.55 | SEC title disagrees with our name |
| ASPC | Alpha Capital | CIK 1890361 'ASPAC III Acquisition Corp.' (ASPC) | 0.41 | SEC title disagrees with our name |
| ASTH | Stran | CIK 1083446 'Astrana Health, Inc.' (ASTH) | 0.53 | SEC title disagrees with our name |
| AVK | Advent | CIK 1219120 'ADVENT CONVERTIBLE & INCOME FUND' (AVK) | 0.33 | SEC title disagrees with our name |
| AXIN | Axiom | CIK 2057030 'Axiom Intelligence Acquisition Corp 1' (AXIN) | 0.27 | SEC title disagrees with our name |
| BCG | BCG | CIK 1953984 'Binah Capital Group, Inc.' (BCG) | 0.25 | SEC title disagrees with our name |
| BCG | Kingswood | CIK 1953984 'Binah Capital Group, Inc.' (BCG) | 0.18 | SEC title disagrees with our name |
| BCSF | Bain Capital | CIK 1655050 'Bain Capital Specialty Finance, Inc.' (BCSF) | 0.57 | name contained in SEC title but below ratio threshold (affiliate-entity risk) |
| BCSF | Bain | CIK 1655050 'Bain Capital Specialty Finance, Inc.' (BCSF) | 0.24 | SEC title disagrees with our name |
| BDMD | Baird | CIK 1982444 'Baird Medical Investment Holdings Ltd' (BDMD) | 0.34 | SEC title disagrees with our name |
| BKD | Senior | CIK 1332349 'Brookdale Senior Living Inc.' (BKD) | 0.41 | SEC title disagrees with our name |
| BOC | OMAH | CIK 1494582 'BOSTON OMAHA Corp' (BOC) | 0.50 | SEC title disagrees with our name |
| BYD | BYD | CIK 906553 'BOYD GAMING CORP' (BYD) | 0.43 | SEC title disagrees with our name |
| BYD | BYD Co. | CIK 906553 'BOYD GAMING CORP' (BYD) | 0.43 | SEC title disagrees with our name |
| CAKE | Factory | CIK 887596 'CHEESECAKE FACTORY INC' (CAKE) | 0.56 | SEC title disagrees with our name |
| CCO | CCO | CIK 1334978 'Clear Channel Outdoor Holdings, Inc.' (CCO) | 0.25 | SEC title disagrees with our name |
| CDIX | AION | CIK 811222 'Cardiff Lexington Corp' (CDIX) | 0.38 | SEC title disagrees with our name |
| CEPF | Cantor | CIK 2034267 'Cantor Equity Partners IV, Inc.' (CEPF) | 0.39 | SEC title disagrees with our name |
| CHYM | Chime | CIK 1795586 'Chime Financial, Inc.' (CHYM) | 0.50 | SEC title disagrees with our name |
| CMTG | Claro | CIK 1666291 'Claros Mortgage Trust, Inc.' (CMTG) | 0.50 | SEC title disagrees with our name |
| COSO | Also | CIK 1297107 'CoastalSouth Bancshares, Inc.' (COSO) | 0.30 | SEC title disagrees with our name |
| CVLT | MMV | CIK 1169561 'COMMVAULT SYSTEMS INC' (CVLT) | 0.30 | SEC title disagrees with our name |
| CWAN | CWAN | CIK 1866368 'Clearwater Analytics Holdings, Inc.' (CWAN) | 0.33 | SEC title disagrees with our name |
| DJT | Trump | CIK 1849635 'Trump Media & Technology Group Corp.' (DJT) | 0.37 | SEC title disagrees with our name |
| EBS | Emergent | CIK 1367644 'Emergent BioSolutions Inc.' (EBS) | 0.55 | SEC title disagrees with our name |
| EEFT | Euronet | CIK 1029199 'EURONET WORLDWIDE, INC.' (EEFT) | 0.58 | SEC title disagrees with our name |
| EGO | EGO | CIK 918608 'ELDORADO GOLD CORP /FI' (EGO) | 0.32 | SEC title disagrees with our name |
| FDP | Del Monte | CIK 1047340 'FRESH DEL MONTE PRODUCE INC' (FDP) | 0.56 | name contained in SEC title but below ratio threshold (affiliate-entity risk) |
| FERA | Fera | CIK 2025401 'Fifth Era Acquisition Corp I' (FERA) | 0.30 | SEC title disagrees with our name |
| FSI | FSI | CIK 1069394 'FLEXIBLE SOLUTIONS INTERNATIONAL INC' (FSI) | 0.29 | SEC title disagrees with our name |
| GBTC | SCA | CIK 1588489 'Grayscale Bitcoin Trust ETF' (GBTC) | 0.25 | SEC title disagrees with our name |
| GBTC | Bitcoin | CIK 1588489 'Grayscale Bitcoin Trust ETF' (GBTC) | 0.50 | SEC title disagrees with our name |
| GCT | GAC | CIK 1857816 'GigaCloud Technology Inc' (GCT) | 0.26 | SEC title disagrees with our name |
| GEMI | Gemini | CIK 2055592 'Gemini Space Station, Inc.' (GEMI) | 0.46 | SEC title disagrees with our name |
| GETY | Neuberger | CIK 1898496 'Getty Images Holdings, Inc.' (GETY) | 0.19 | SEC title disagrees with our name |
| GHY | PGIM | CIK 1554697 'PGIM Global High Yield Fund, Inc.' (GHY) | 0.26 | SEC title disagrees with our name |
| GIC | GIC | CIK 945114 'GLOBAL INDUSTRIAL Co' (GIC) | 0.20 | SEC title disagrees with our name |
| GO | Go Inc. | CIK 1771515 'Grocery Outlet Holding Corp.' (GO) | 0.25 | SEC title disagrees with our name |
| GOVB | Verne | CIK 1978811 'Gouverneur Bancorp, Inc./MD/' (GOVB) | 0.38 | SEC title disagrees with our name |
| GPI | GPI | CIK 1031203 'GROUP 1 AUTOMOTIVE INC' (GPI) | 0.13 | SEC title disagrees with our name |
| GSRF | GSR | CIK 2072404 'GSR IV Acquisition Corp.' (GSRF) | 0.29 | SEC title disagrees with our name |
| GV | GV | CIK 1892274 'Visionary Holdings Inc.' (GV) | 0.18 | SEC title disagrees with our name |
| HAVA | Harvard | CIK 2042460 'Harvard Ave Acquisition Corp' (HAVA) | 0.47 | SEC title disagrees with our name |
| HG | Hg | CIK 1593275 'Hamilton Insurance Group, Ltd.' (HG) | 0.10 | SEC title disagrees with our name |
| HURN | Huron | CIK 1289848 'Huron Consulting Group Inc.' (HURN) | 0.48 | SEC title disagrees with our name |
| JWSMF | AWS | CIK 1831359 'Jaws Mustang Acquisition Corp' (JWSMF) | 0.22 | SEC title disagrees with our name |
| LEO | BNY | CIK 818972 'BNY MELLON STRATEGIC MUNICIPALS, INC.' (LEO) | 0.18 | SEC title disagrees with our name |
| LGDTF | LGDTF | CIK 1755191 'Liberty Gold Corp. /CAN' (LGDTF) | 0.29 | SEC title disagrees with our name |
| LOT | L Catterton | CIK 1962746 'Lotus Technology Inc.' (LOT) | 0.37 | SEC title disagrees with our name |
| LYRA | Lyra | CIK 1327273 'Lyra Therapeutics, Inc.' (LYRA) | 0.38 | SEC title disagrees with our name |
| MAKO | Mako | CIK 1784930 'Mako Mining Corp.' (MAKO) | 0.53 | SEC title disagrees with our name |
| MCFT | Craft | CIK 1638290 'MasterCraft Boat Holdings, Inc.' (MCFT) | 0.48 | SEC title disagrees with our name |
| MIR | Mir | CIK 1809987 'Mirion Technologies, Inc.' (MIR) | 0.27 | SEC title disagrees with our name |
| MTA | MTA | CIK 1722606 'Metalla Royalty & Streaming Ltd.' (MTA) | 0.21 | SEC title disagrees with our name |
| MX | Magna | CIK 1325702 'MAGNACHIP SEMICONDUCTOR Corp' (MX) | 0.36 | SEC title disagrees with our name |
| NAT | Nordic | CIK 1000177 'NORDIC AMERICAN TANKERS Ltd' (NAT) | 0.41 | SEC title disagrees with our name |
| NCLH | NCLH | CIK 1513761 'Norwegian Cruise Line Holdings Ltd.' (NCLH) | 0.24 | SEC title disagrees with our name |
| NOEM | O2 | CIK 1956648 'CO2 Energy Transition Corp.' (NOEM) | 0.17 | SEC title disagrees with our name |
| NTCL | TCL | CIK 1927578 'NetClass Technology Inc' (NTCL) | 0.27 | SEC title disagrees with our name |
| OBT | Orange | CIK 1754226 'Orange County Bancorp, Inc. /DE/' (OBT) | 0.40 | SEC title disagrees with our name |
| OCSL | Oaktree | CIK 1414932 'Oaktree Specialty Lending Corp' (OCSL) | 0.44 | SEC title disagrees with our name |
| PAM | PAM | CIK 1469395 'Pampa Energy Inc.' (PAM) | 0.40 | SEC title disagrees with our name |
| PDI | PIMCO | CIK 1510599 'PIMCO Dynamic Income Fund' (PDI) | 0.33 | SEC title disagrees with our name |
| PLAB | Otro | CIK 810136 'PHOTRONICS INC' (PLAB) | 0.57 | SEC title disagrees with our name |
| PTON | Peloton | CIK 1639825 'PELOTON INTERACTIVE, INC.' (PTON) | 0.54 | SEC title disagrees with our name |
| RGTI | Gett | CIK 1838359 'Rigetti Computing, Inc.' (RGTI) | 0.38 | SEC title disagrees with our name |
| RGTI | Rigetti | CIK 1838359 'Rigetti Computing, Inc.' (RGTI) | 0.58 | SEC title disagrees with our name |
| RNGR | Ranger | CIK 1699039 'Ranger Energy Services, Inc.' (RNGR) | 0.43 | SEC title disagrees with our name |
| RVLGF | RVLGF | CIK 1616885 'Revival Gold Inc.' (RVLGF) | 0.47 | SEC title disagrees with our name |
| SEG | Seaport | CIK 2009684 'Seaport Entertainment Group Inc.' (SEG) | 0.50 | SEC title disagrees with our name |
| SKE | SKE | CIK 1713748 'Skeena Resources Ltd' (SKE) | 0.32 | SEC title disagrees with our name |
| SKYE | Skye | CIK 1516551 'Skye Bioscience, Inc.' (SKYE) | 0.42 | SEC title disagrees with our name |
| SMTK | TKE | CIK 1817760 'SmartKem, Inc.' (SMTK) | 0.55 | SEC title disagrees with our name |
| SRZN | Roze | CIK 1824893 'Surrozen, Inc./DE' (SRZN) | 0.53 | SEC title disagrees with our name |
| STG | STG | CIK 1723935 'Sunlands Technology Group' (STG) | 0.27 | SEC title disagrees with our name |
| STVN | NATO | CIK 1849853 'Stevanato Group S.p.A.' (STVN) | 0.42 | SEC title disagrees with our name |
| TBPH | Avance | CIK 1583107 'Theravance Biopharma, Inc.' (TBPH) | 0.46 | SEC title disagrees with our name |
| TSM | TSMC | CIK 1046179 'TAIWAN SEMICONDUCTOR MANUFACTURING CO LTD' (TSM) | 0.21 | SEC title disagrees with our name |
| UEC | UEC | CIK 1334933 'URANIUM ENERGY CORP' (UEC) | 0.24 | SEC title disagrees with our name |
| UP | UP | CIK 1819516 'Wheels Up Experience Inc.' (UP) | 0.18 | SEC title disagrees with our name |
| URBN | Urban Company | CIK 912615 'URBAN OUTFITTERS INC' (URBN) | 0.48 | SEC title disagrees with our name |
| VOYG | Voyager | CIK 1788060 'Voyager Technologies, Inc./DE' (VOYG) | 0.47 | SEC title disagrees with our name |
| XFLT | xAI | CIK 1703079 'XAI Octagon Floating Rate & Alternative Income Trust' (XFLT) | 0.13 | SEC title disagrees with our name |
| XRN | Hiro | CIK 1533615 'Chiron Real Estate Inc.' (XRN) | 0.36 | SEC title disagrees with our name |
| YMM | Alliance | CIK 1838413 'Full Truck Alliance Co. Ltd.' (YMM) | 0.59 | SEC title disagrees with our name |

## B4 unmatched tickers

002415.SZ, 2223.SR, 4565.T, 600941.SS, 688408.SS, 7203.T, ACTD, ASPU, AXAC, BKMP, BRYN, BSEG, BXRXQ, CFLT, CGPOWER.NS, CHFW, CHX, COFORGE.NS, CTRA, CXBS, CYBR, ECDD, ECLP, ELYS, EMPO, ENV, EP PR C, ESTRF, EVRC, EWCZ, FFZY, FL, FNA, GBNHF, GRCO, GRCU, GYPHQ, HBI, HES, HOLX, ICBT, INFN, IPO-ELLT, IVCA, JNPR, KKC.AX, KMAR.OL, KPITTECH.NS, KVIL, KVSD, LLNXF, LNBY, MFD, MPIR, MRK1T.TL, NCRE, NKLAQ, OSCI, PHARM.AS, PIEJF, PLTT, PNST, POLICYBZR.NS, POLYCAB.NS, PORT, PSCO, PWSC, RBSY, RCM, SAVEQ, SFLM, SHELL.AS, SIX, SLCO, SN.L, SNST, SPR, SQCF, SRCH, SSNLF, TGNA, TNEN, TOWN, TRTN PR A, UATG, USPS, VAYK, VCSA, VTXB, WIRE, WSSE, X, XCPCX
