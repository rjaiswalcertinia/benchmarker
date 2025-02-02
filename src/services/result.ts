/** @ignore */
/*
 * Copyright (c) 2024 Certinia Inc. All rights reserved.
 */

import {
  getDatabaseUrl,
  shouldStoreAlerts,
  getRangeCollection,
} from '../shared/env';
import { OrgContext } from './org/context';
import {
  TestResultOutput,
  convertOutputToTestResult,
  addAlertByComparingAvg,
  getReporters,
} from './result/output';
import { save } from './result/save';
import { getAverageLimitValuesFromDB } from '../database/alertInfo';
import { Alert } from '../database/entity/alert';

export async function reportResults(
  testResultOutput: TestResultOutput[],
  orgContext: OrgContext
): Promise<void> {
  const results = testResultOutput.map(convertOutputToTestResult);

  // run loggers
  for (const reporter of getReporters()) {
    try {
      await reporter.report(results);
    } catch (err) {
      if (err instanceof Error) {
        console.error(
          `Error running reporter '${reporter.name}': ${err.message}`
        );
      }
    }
  }

  if (getDatabaseUrl()) {
    try {
      // Extract flowName and actionName pairs from the test results
      const needToStoreAlert = testResultOutput.filter(
        result =>
          !(result.alertInfo && result.alertInfo.storeAlerts === false) &&
          shouldStoreAlerts()
      );
      const flowActionPairs = needToStoreAlert.map(result => ({
        flowName: result.flowName,
        actionName: result.action,
      }));

      let validAlerts: Alert[] = [];
      // Fetch average values for all flow-action pairs
      if (!(flowActionPairs?.length === 0)) {
        const preFetchedAverages =
          await getAverageLimitValuesFromDB(flowActionPairs);
        const rangeCollection = getRangeCollection();
        // Generate alerts based on pre-fetched averages
        const alerts = await Promise.all(
          needToStoreAlert.map(
            async item =>
              await addAlertByComparingAvg(
                item,
                preFetchedAverages,
                rangeCollection
              )
          )
        );

        validAlerts = alerts.filter((alert): alert is Alert => {
          return (
            alert.cpuTimeDegraded > 0 ||
            alert.dmlRowsDegraded > 0 ||
            alert.dmlStatementsDegraded > 0 ||
            alert.heapSizeDegraded > 0 ||
            alert.queryRowsDegraded > 0 ||
            alert.queryRowsDegraded > 0
          );
        });
      }
      await save(results, orgContext, validAlerts);
    } catch (err) {
      console.error(
        'Failed to save results to database. Check DATABASE_URL environment variable, unset to skip saving.'
      );
      throw err;
    }
  }
}
