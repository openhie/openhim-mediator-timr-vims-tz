Introduction to TImR-VIMS Data Sync
====================================
This documentation will be talking of a openHIM mediator written in nodejs that is responsible for synchronizing data from TImR to VIMS. The mediator is made up of several end points, and each end point is responsible for synchronizing its dedicated data element.

**Theory Behind TImR and VIMS Data Sync**

The mediator maintains mapping of vaccines and items between VIMS and TImR that it uses to translate messages that are to be sent to either TImR or VIMS.
For data synchronization from TImR to VIMS, The mediator pulls data from TImR warehouse and then it does the translation by converting the data to a format supported by VIMS and then translate all the TImR products to respective VIMS products and then submit a data bundle that consists of 100 facilities data to VIMS.
The mediator also has a POST end point that receives stock distributions that are to be forwarded to TImR. Once the mediator has received stock distribution, it does convert the message received to GS1 message with all vaccines translated to respective TImR vaccine codes and finally submit the distribution to TImR.

**Data Elements That The Mediator Pushes To TImR**

#.  Immunization Coverage Data
#.  Supplements Data
#.  Adverse Effects Data
#.  Disease Data
#.  CTC Referral Data
#.  Breast Feeding Data
#.  PMTCT Data
#.  Mosquito Net Data
#.  TT Data
#.  Child Visit Data
#.  Weight Age Ratio Data
#.  Cold Chain Data
#.  Stock Data

**openHIM Channels And Mediator Routes**

.. list-table:: Routes and Channels

  * - openHIM Channel
    - Mediator Route
    - Descriptions

  * - TImR and VIMS TT Data Sync
    - /syncTT
    - Responsible for TT data sync

  * - TImR and VIMS Supplements Sync
    - /syncSupplements
    - Responsible for supplements data sync

  * - TImR and VIMS PMTCT Sync
    - /syncPMTCT
    - Responsible for PMTCT data sync

  * - TImR and VIMS Mosquito Sync
    - /syncMosquitoNet
    - Responsible for mosquito net data sync

  * - TImR and VIMS Immunization Coverage Sync
    - /syncImmunizationCoverage
    - Responsible for immunization coverage data sync

  * - TImR and VIMS Immunization Coverage Agegrp Sync
    - /syncImmCovAgeGrp
    - Responsible for immunization coverage data sync - by age groups

  * - TImR and VIMS Disease Sync
    - /syncDiseases
    - Responsible for disease data sync

  * - TImR and VIMS CTC Referal Sync
    - /syncCTCReferal
    - Responsible for CTC data sync

  * - TImR and VIMS Cold Chain Sync
    - /syncColdChain
    - Responsible for cold chain data sync

  * - TImR and VIMS Child Visit Sync
    - /syncChildVisit
    - Responsible for child visit data sync

  * - TImR and VIMS Breast Feeding Sync
    - /syncBreastFeeding
    - Responsible for breast feeding data sync

  * - TImR and VIMS Age-Weight Ratio Sync
    - /syncWeightAgeRatio
    - Responsible for weight age ratio data sync

  * - TImR and VIMS Adverse Events Sync
    - /syncAdverseEffects
    - Responsible for adverse effects data sync

  * - Get Despatch Advice from VIMS - VIMS Intiated
    - /despatchAdviceVims
    - Responsible for receiving stock distribution from VIMS and submit to TImR

  * - Get Despatch Advice from VIMS - IL Intiated
    - /despatchAdviceIL
    - It can be triggered to pull stock distributions from VIMS and push them to TImR

  * - Send Proof Of Delivery To VIMS
    - /receivingAdvice
    - It receives proof of delivery from TImR and forwards it to VIMS

  * - TImR and VIMS Onhand Stock Sync
    - /syncStockOnHand
    - Responsible for Stock on hand data sync

  * - TImR and VIMS Adjustment Stock Sync
    - /syncStockAdjustments
    - Responsible for stock adjustments data sync

  * - Initialize Report In VIMS Facilities
    - /initializeReport
    - It initializes new VIMS reports

  * - Cache VIMS Facilities Reports
    - /cacheFacilitiesData
    - It gets open facility report from VIMS and caches it internally