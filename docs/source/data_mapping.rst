TImR and VIMS Data Elements Mapping
=========================================
Before sending data to either TImR or VIMS, the mediator needs to translate all the codes on the message i.e if mediator is sending immunization coverage data to VIMS
It will first attempt to translate all the TImR vaccine codes to respective VIMS vaccine codes before sending immunization data to VIMS. The mediator maintains these mapping
into JSON files located under terminologies folder. i.e all code mapping used for the immunization coverage data sync are located inside a file called timr-vims-dwh-immunization-conceptmap.json.
Below is a full list of all the mapping files

**Mapping FIles**
  #.  timr-vims-dwh-immunization-conceptmap.json

      * All vaccines code are mapped on this file

  #.  timr-vims-diseases-conceptmap.json

      * All disease codes are mapped on this file

  #.  timr-vims-dwh-vitamin-conceptmap.json

      * Vitamin codes are mapped on this file

  #.  timr-vims-items-conceptmap.json

      * All items codes are mapped on this file

**Example On How To Map Codes**
  Any time there is a new item or vaccine, it must be added on a respective maping file above. For example if there is a new vaccine introduced that has a TImR code of JJ123 and VIMS code 4XJJ
  The mapping will be done as below on the timr-vims-dwh-immunization-conceptmap.json file

  .. code-block:: bash

    {
      "code": "4XJJ",
      "target": [{
        "code": "JJ123",
        "equivalence": "wider"
      }]
    }