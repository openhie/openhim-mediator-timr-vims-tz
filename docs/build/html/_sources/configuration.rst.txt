Configuring The Mediator
========================
*Configuration to connect the mediator with openHIM*
  inside the mediator, use your preffered text editor and open config.json under config folder

  .. code-block:: bash

    vim config/config.json

  Below is the content of config.json

  .. code-block:: bash

    {
      "api": {
        "username": "root@openhim.org",
        "password": "openhim-password",
        "apiURL": "https://localhost:8080",
        "trustSelfSigned": true
      },
      "register": true
    }

  Change username and password to a real account that can connect to openHIM

  If the mediator and openHIM are on different servers, then you will need to change the apiURL

**You need to start the mediator with below commands before you can proceed with the rest of the configurations**

.. code-block:: bash

   cd openhim-mediator-timr-vims-tz
   node index.js

*Configuration parameters of the mediator with TImR and VIMS credentials*
  Login to openHIM and click the mediators link

  Click to open the TImR-VIMS Trigger mediator

  .. image:: images/mediator-index.png
    :height: 200 px
    :width: 900 px
    :scale: 100 %
    :alt: alternate text

  Click the gear icon next to configuration to open the configuration page that looks as below

  .. image:: images/mediator-configuration.png

  #. TImR OAUTH2 section defines credentials needed to request access token from TImR that will be used to query data in TImR

  #. TImR section defines credentials for querying data from TImR

  #. VIMS section defines credentials required to push data to VIMS.

      * URL: is the VIMS base URL
      * username: is the user that has permission to push data to VIMS.
      * password: is the password of the user that has permission to push data to VIMS

  #. FHIR Server section defines credentials for accessing data from the matching tool

  #. SMS Aggregator section defines credentials needed for sending bulk SMS with url being the base URL of the aggregator

  #. Email Notification section defines credentials for sending emails and email addresses to receive mediator notifications