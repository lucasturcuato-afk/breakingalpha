"""
Unit tests for the two unanchored-substring defects in backend/wikidata.py's
_classify(), and for the intended drops that must survive the fix.

Defect 1 -- "human" was a HARD drop substring, put there to catch a natural
person. As a bare substring it also matched phrases about things that are not
people at all, and hard-dropped six real companies:
    ADP        "american human resources management software company"
    Intuitive  "... intended for human use"
    Madrigal   "human settlement in atienza, ..."
    Seaboard   "human settlement in northampton county, ..."
    Peraso     "human settlement in ghana"
    xAI        "ai whose processes can be understood by humans"
It is now an anchored pattern: the description must BE the person type.

Defect 2 -- Wikidata's top hit for a bare exchange ticker is frequently the ISO
3166 country sharing those letters (GM -> The Gambia, GE -> Georgia, ARM ->
Armenia, VZ -> Venezuela), so the sovereignty HARD keywords fired on a real
company's ticker. Those keywords are now skipped for a ticker-shaped name.

Every fixture description below is the verbatim lowercased string stored in the
live wikidata_entity_cache table, so these are replays, not invented strings.

NO network, NO Supabase: _classify is pure (description, name) -> verdict.

Run from the repo root:
    python -m unittest backend.tests.test_wikidata_substring_gates
"""
import unittest

from backend.wikidata import _classify


class HumanSubstringVictimsTest(unittest.TestCase):
    """The six named victims of the bare "human" substring."""

    def test_adp_is_a_company_not_a_person(self):
        # "human resources" contained "human". The KEEP word "company" now wins.
        self.assertIs(
            _classify("american human resources management software company", "ADP"),
            True,
        )

    def test_intuitive_no_longer_hard_dropped(self):
        self.assertIsNot(
            _classify(
                "learnability and ease-of-use of a helpful tool, system, etc. "
                "intended for human use",
                "Intuitive",
            ),
            False,
        )

    def test_human_settlement_no_longer_hard_dropped(self):
        for name, desc in [
            ("Madrigal", "human settlement in atienza, guadalajara province, "
                         "castile-la mancha, spain"),
            ("Seaboard", "human settlement in northampton county, north carolina, "
                         "united states of america"),
            ("Peraso", "human settlement in ghana"),
            ("Erasca", "human settlement in italy"),
            ("Nonantum", "human settlement in massachusetts, united states of america"),
        ]:
            self.assertIsNot(_classify(desc, name), False,
                             f"still hard-dropped by the human substring: {name!r}")

    def test_xai_no_longer_hard_dropped(self):
        self.assertIsNot(
            _classify("ai whose processes can be understood by humans", "xAI"), False
        )


class TickerCountryCodeVictimsTest(unittest.TestCase):
    """The ISO 3166 code collisions. Verbatim cached descriptions."""

    CASES = [
        ("GM", "sovereign state in west africa"),                        # The Gambia
        ("GE", "country in the caucasus region of europe and asia"),     # Georgia
        ("ARM", "sovereign state in the south caucasus region of eurasia"),
        ("MA", "sovereign state in north africa"),                       # Morocco
        ("VZ", "country in south america"),                              # Venezuela
        ("CI", "sovereign state in west africa"),                        # Cote d'Ivoire
        ("GD", "island sovereign state in the caribbean sea"),           # Grenada
        ("CZR", "country in central europe"),                            # Czechia
        ("HUN", "country in central europe"),                            # Hungary
        ("KOS", "country in southeastern europe"),                       # Kosovo
        ("MLI", "country in west africa"),                               # Mali
        ("BEL", "country in western europe"),                            # Belgium
        ("ALG", "country in north africa"),                              # Algeria
        ("ST", "island sovereign state in africa"),                      # Sao Tome
        ("VC", "island sovereign state in the caribbean sea"),           # St Vincent
        ("ATG", "island sovereign state in the caribbean sea"),          # Antigua
        ("MDV", "sovereign state in south asia, situated on an archipelago "
                "in the arabian sea"),                                   # Maldives
        ("RH", "country in central europe"),
        ("Z", "country in southern africa"),
    ]

    def test_ticker_shaped_names_are_not_hard_dropped_as_countries(self):
        for name, desc in self.CASES:
            self.assertIsNot(_classify(desc, name), False,
                             f"ticker still dropped as a country: {name!r}")


class IntendedDropsStillFireTest(unittest.TestCase):
    """Negative set. Every fixture is a genuine non-company and must stay False."""

    NATURAL_PERSONS = [
        ("Elon Musk", "businessman and entrepreneur (born 1971)"),
        ("Carl Icahn", "american businessman"),
        ("Barry Diller", "american businessman"),
        ("David Tepper", "american businessman"),
        ("Nelson Peltz", "american businessman and art collector"),
        ("Rick Caruso", "american businessman"),
        ("Tilman Fertitta", "american businessman"),
        ("Del Webb", "american businessman"),
        ("Ace Green", "businessman (1927-2014)"),
        ("Robert W. Baird", "american businessman (1883-1968)"),
        ("Leon Black", "american billionaire businessman, moma chairman, "
                       "art collector (born 1951)"),
        ("Chamath Palihapitiya", "sri lankan-born canadian-american businessman "
                                 "and ceo of social capital"),
        ("Elizabeth Warren", "american politician (born 1949)"),
        ("Albert Bartlett", "politician in massachusetts, us (1851-1934)"),
        ("Rose Merc", "filipino politician"),
        ("William Blair", "politician in dakota territory"),
        ("Donald Trump", "president of the united states (2017-2021; since 2025)"),
    ]

    NON_COMPANIES = [
        ("Iraq", "sovereign state in western asia"),
        ("Greece", "country in southeast europe"),
        ("Vietnam", "country in southeast asia"),
        ("Nippon", "island country in east asia"),
        ("Dominion", "island country in the southwest pacific ocean"),
        ("Fin", "country in northern europe"),
        ("Ant", "island sovereign state in the caribbean sea"),
        ("Hezbollah", "iranian-backed shia islamist political party and armed "
                      "organization in lebanon"),
        ("Vox", "spanish political party"),
        ("ALP", "federal political party in australia"),
        ("PKS", "political party in indonesia"),
        ("MSI", "neo-fascist and post-fascist political party in italy"),
        ("NORGES BANK", "central bank of norway"),
        ("Czech National Bank", "the central bank and financial market supervisor "
                                "in the czech republic"),
        ("HKMA", "currency board and central banking authority of hong kong"),
        ("United States Space Force", "space warfare branch of the united states "
                                      "armed forces"),
        ("USAR", "land service branch of the united states armed forces"),
        ("Colombian Aerospace Force", "air and space warfare branch of colombia's "
                                      "armed forces"),
        ("ASPC", "agency of the government of canada"),
        ("Dubai Financial Services Authority", "financial regulatory agency, dubai"),
        ("DCI", "(1946-2005) former office of the head of the united states "
                "central intelligence agency"),
    ]

    def test_natural_persons_still_drop(self):
        for name, desc in self.NATURAL_PERSONS:
            self.assertIs(_classify(desc, name), False,
                          f"natural person no longer dropped: {name!r}")

    def test_non_companies_still_drop(self):
        for name, desc in self.NON_COMPANIES:
            self.assertIs(_classify(desc, name), False,
                          f"non-company no longer dropped: {name!r}")

    def test_bare_human_description_still_drops(self):
        # This is the case the "human" keyword was added for: Wikidata's person
        # type as the whole description. The anchored pattern keeps it.
        for desc in ["human", "humans", "human (1950-2020)", "human, born 1971"]:
            self.assertIs(_classify(desc, "Some Person"), False,
                          f"bare person description no longer dropped: {desc!r}")

    def test_natural_person_keyword_untouched(self):
        self.assertIs(_classify("natural person under german law", "Foo"), False)


class BoundaryCasesTest(unittest.TestCase):
    """The edges the fix introduces."""

    def test_ticker_guard_is_case_sensitive(self):
        # "Iraq" and "Arm" are not ticker-shaped (lowercase letters), so the
        # sovereignty keywords still hard-drop them. Only an all-caps 1-3 letter
        # token gets the ISO-code benefit of the doubt.
        self.assertIs(_classify("sovereign state in western asia", "Iraq"), False)
        self.assertIs(
            _classify("sovereign state in the south caucasus region of eurasia", "Arm"),
            False,
        )
        self.assertIsNot(
            _classify("sovereign state in the south caucasus region of eurasia", "ARM"),
            False,
        )

    def test_ticker_guard_stops_at_four_letters(self):
        # ISO 3166 codes are two or three letters. A four-letter all-caps name is
        # not a code collision, so nothing is relaxed for it.
        self.assertIs(_classify("country in southeast asia", "LAOS"), False)
        self.assertIs(_classify("country in east asia", "CHINA"), False)

    def test_ticker_guard_only_relaxes_the_sovereignty_keywords(self):
        # Every other HARD keyword still fires on a ticker-shaped name.
        self.assertIs(_classify("american politician (born 1949)", "EW"), False)
        self.assertIs(_classify("central bank of norway", "NB"), False)
        self.assertIs(_classify("federal political party in australia", "ALP"), False)
        self.assertIs(_classify("american businessman", "EM"), False)

    def test_human_anchor_requires_the_description_to_be_the_person_type(self):
        # Anchored at the start and not followed by another word.
        self.assertIs(_classify("human", "X"), False)
        self.assertIsNot(_classify("human rights organization", "X"), False)
        self.assertIsNot(_classify("human capital management platform", "X"), False)
        self.assertIsNot(_classify("inhuman", "X"), False)
        self.assertIsNot(_classify("understood by humans", "X"), False)

    def test_unrelated_descriptions_are_unchanged(self):
        self.assertIs(_classify("american multinational technology company", "Apple"), True)
        self.assertIs(_classify("country in western europe", "France"), False)
        self.assertIs(_classify("cryptocurrency", "Dogecoin"), False)
        self.assertIs(
            _classify("company that operates a cryptocurrency exchange", "Coinbase"),
            True,
        )
        self.assertIsNone(_classify("", "Unknown Thing"))
        self.assertIsNone(_classify(None, "Some Private Startup"))

    def test_no_result_name_heuristics_untouched(self):
        self.assertIs(_classify(None, "Chipmakers"), False)
        self.assertIs(_classify(None, "the semiconductor sector"), False)


class LeftTokenBoundaryTest(unittest.TestCase):
    """Defect 3 -- a description keyword firing INSIDE a word.

    _classify is the last gate before entity_resolver._try_insert_canonical,
    which mints a companies row for whatever surface form it is handed. A KEEP
    keyword that fires inside a word mints on evidence that is not there, and in
    the two cases below the surrounding word says the OPPOSITE.

    Every description is verbatim from the live wikidata_entity_cache. All five
    are the complete set of verdict changes this rule makes over that whole
    table, so the negative half of this class is the non-regression argument.
    """

    #: name -> description, verbatim. Four of these five names are `companies`
    #: rows today with a null ticker and a null sec_cik.
    INTERIOR_KEEPS = [
        ("Mill Point", "unincorporated community in pocahontas county, "
                       "west virginia, united states"),
        ("Rockbridge", "unincorporated community in hocking county, ohio"),
        ("NMI", "unincorporated territory of the us located in the pacific"),
        ("MP", "unincorporated territory of the us located in the pacific"),
        ("UK Biobank", "longterm biobank study of 500,000 people"),
    ]

    def test_a_keep_keyword_inside_a_word_no_longer_keeps(self):
        for name, desc in self.INTERIOR_KEEPS:
            # The pre-fix predicate, spelled out, so each fixture is proven to
            # be a real interior hit rather than a case that never fired.
            self.assertTrue(
                any(kw in desc for kw in ("incorporated", "bank")),
                f"fixture is not an interior-substring case: {name!r}",
            )
            self.assertIsNot(
                _classify(desc, name), True,
                f"still kept on an interior substring: {name!r}",
            )

    def test_unincorporated_is_not_evidence_of_incorporation(self):
        self.assertIsNot(_classify("unincorporated community in ohio", "X"), True)
        self.assertIs(_classify("incorporated in delaware", "X"), True)

    def test_trailing_inflections_still_count_as_evidence(self):
        # LEFT boundary only. A suffix keeps the meaning, and these carry most
        # of the KEEP volume in the live cache: a right boundary as well would
        # cost every one of them.
        for name, desc in [
            ("CIBC", "canadian banking institution"),
            ("BBVA", "spanish banking group"),
            ("Bradesco", "brazilian banking institution"),
            ("Silicon Valley Bank", "american banking service"),
            ("Alerus Financial", "chain of financial institutions headquartered "
                                 "in grand forks, north dakota"),
            ("Station F", "business incubator for startups, located in paris"),
            ("Raiffeisen Bank International AG",
             "central institution of austrian co-operative banking group raffeisen"),
        ]:
            self.assertIs(_classify(desc, name), True,
                          f"inflected keep keyword lost: {name!r}")

    def test_hard_drops_still_fire_through_an_inflection(self):
        # The same asymmetry protects the drop side. "central banking authority"
        # still starts with "central bank".
        self.assertIs(
            _classify("currency board and central banking authority of hong kong",
                      "HKMA"),
            False,
        )
        self.assertIs(_classify("american politician (born 1949)", "EW"), False)

    def test_a_hard_drop_keyword_inside_a_word_no_longer_drops(self):
        # Same rule, drop side: "government" inside "nongovernment" must not
        # categorically drop the entity.
        self.assertIsNot(_classify("nongovernmental standards body", "X"), False)
        self.assertIs(_classify("government agency of canada", "X"), False)


if __name__ == "__main__":
    unittest.main()
