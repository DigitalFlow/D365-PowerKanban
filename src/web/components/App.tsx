import * as React from "react";
import { AppStateProvider } from "../domain/AppState";
import { SplitView } from "./SplitView";
import { ActionStateProvider } from "../domain/ActionState";
import { ConfigStateProvider } from "../domain/ConfigState";
import { ErrorBoundary } from "./ErrorBoundary";

export interface AppProps
{
  configId?: string;
  primaryEntityId?: string;
  appId?: string;
  primaryDataSet: ComponentFramework.PropertyTypes.DataSet;
  primaryDataIds?: Array<string>;
}

export const App: React.FC<AppProps> = (props) => {
  return (
    <ErrorBoundary>
      <AppStateProvider primaryDataIds={props.primaryDataSet.sortedRecordIds} primaryDataSet={props.primaryDataSet} primaryEntityId={props.primaryEntityId}>
        <ActionStateProvider>
          <ConfigStateProvider appId={props.appId} configId={props.configId} primaryEntityLogicalName={props.primaryDataSet.getTargetEntityType()}>
            <ErrorBoundary>
              <SplitView primaryDataIds={props.primaryDataSet.sortedRecordIds} />
            </ErrorBoundary>
          </ConfigStateProvider>
        </ActionStateProvider>
      </AppStateProvider>
    </ErrorBoundary>
  );
};