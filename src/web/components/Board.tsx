import * as React from "react";
import * as WebApiClient from "xrm-webapi-client";
import { BoardViewConfig, BoardEntity } from "../domain/BoardViewConfig";
import { useAppContext } from "../domain/AppState";
import { formatGuid } from "../domain/GuidFormatter";
import { Lane } from "./Lane";
import { Metadata, Attribute, Option } from "../domain/Metadata";
import { SavedQuery } from "../domain/SavedQuery";
import { CardForm, parseCardForm } from "../domain/CardForm";
import { fetchData, refresh, fetchSubscriptions, fetchNotifications } from "../domain/fetchData";
import { Tile } from "./Tile";
import { DndContainer } from "./DndContainer";
import { loadExternalScript } from "../domain/LoadExternalScript";
import { useConfigContext, ConfigStateProps } from "../domain/ConfigState";
import { useActionContext, DisplayType } from "../domain/ActionState";
import { SearchBox } from "@fluentui/react/lib/SearchBox";
import { Spinner } from "@fluentui/react/lib/Spinner";
import { PrimaryButton, CommandBarButton, IButtonStyles, IconButton, DefaultButton } from "@fluentui/react/lib/Button";
import { Dropdown, IDropdownOption, IDropdownStyles } from "@fluentui/react/lib/Dropdown";
import { OverflowSet, IOverflowSetItemProps } from "@fluentui/react/lib/OverflowSet";
import { IContextualMenuProps, IContextualMenuItem } from "@fluentui/react/lib/ContextualMenu";
import { ICardStyles } from '@uifabric/react-cards';
import { BoardLane } from "../domain/BoardLane";

const determineAttributeUrl = (attribute: Attribute) => {
  if (attribute.AttributeType === "Picklist") {
    return "Microsoft.Dynamics.CRM.PicklistAttributeMetadata";
  }

  if (attribute.AttributeType === "Status") {
    return "Microsoft.Dynamics.CRM.StatusAttributeMetadata";
  }

  if (attribute.AttributeType === "State") {
    return "Microsoft.Dynamics.CRM.StateAttributeMetadata";
  }

  if (attribute.AttributeType === "Boolean") {
    return "Microsoft.Dynamics.CRM.BooleanAttributeMetadata";
  }

  throw new Error(`Type ${attribute.AttributeType} is not allowed as swim lane separator.`);
};

const fetchSeparatorMetadata = async (entity: string, swimLaneSource: string, metadata: Metadata) => {
  const cacheKey = `__d365powerkanban_entity_${entity}_field_${swimLaneSource}`;
  const cachedEntry = sessionStorage.getItem(cacheKey);

  if (cachedEntry != null) {
    return JSON.parse(cachedEntry);
  }

  const field = metadata.Attributes.find(a => a.LogicalName.toLowerCase() === swimLaneSource.toLowerCase())!;
  const typeUrl = determineAttributeUrl(field);

  const response: Attribute = await WebApiClient.Retrieve({entityName: "EntityDefinition", queryParams: `(LogicalName='${entity}')/Attributes(LogicalName='${field.LogicalName}')/${typeUrl}?$expand=OptionSet`});
  sessionStorage.setItem(cacheKey, JSON.stringify(response));

  return response;
};

const fetchMetadata = async (entity: string) => {
  const cacheKey = `__d365powerkanban_entity_${entity}`;
  const cachedEntry = sessionStorage.getItem(cacheKey);

  if (cachedEntry != null) {
    return JSON.parse(cachedEntry);
  }

  const response = await WebApiClient.Retrieve({entityName: "EntityDefinition", queryParams: `(LogicalName='${entity}')?$expand=Attributes`});
  sessionStorage.setItem(cacheKey, JSON.stringify(response));

  return response;
};

const fetchViews = async (entity: string) => {
  const cacheKey = `__d365powerkanban_views_${entity}`;
  const cachedEntry = sessionStorage.getItem(cacheKey);

  if (cachedEntry != null) {
    return JSON.parse(cachedEntry);
  }

  const response = await WebApiClient.Retrieve({entityName: "savedquery", queryParams: `?$select=layoutxml,fetchxml,savedqueryid,name&$filter=returnedtypecode eq '${entity}' and querytype eq 0 and statecode eq 0`});
  sessionStorage.setItem(cacheKey, JSON.stringify(response));

  return response;
};

const fetchForms = async (entity: string) => {
  const cacheKey = `__d365powerkanban_forms_${entity}`;
  const cachedEntry = sessionStorage.getItem(cacheKey);

  if (cachedEntry != null) {
    return JSON.parse(cachedEntry);
  }

  const response = await WebApiClient.Retrieve({entityName: "systemform", queryParams: `?$select=formxml,name&$filter=objecttypecode eq '${entity}' and type eq 11`});
  sessionStorage.setItem(cacheKey, JSON.stringify(response));

  return response;
};

const fetchConfig = async (configId: string): Promise<BoardViewConfig> => {
  const cacheKey = `__d365powerkanban_config_${configId}`;
  const cachedEntry = sessionStorage.getItem(cacheKey);

  if (cachedEntry != null) {
    return JSON.parse(cachedEntry);
  }

  const config = await WebApiClient.Retrieve({entityName: "oss_powerkanbanconfig", entityId: configId, queryParams: "?$select=oss_value" });
  sessionStorage.setItem(cacheKey, config.oss_value);
  
  return JSON.parse(config.oss_value);
};

type DisplayState = "simple" | "advanced";

export const Board = () => {
  const [ appState, appDispatch ] = useAppContext();
  const [ actionState, actionDispatch ] = useActionContext();
  const [ configState, configDispatch ] = useConfigContext();

  const [ views, setViews ] = React.useState<Array<SavedQuery>>([]);
  const [ secondaryViews, setSecondaryViews ] = React.useState<Array<SavedQuery>>([]);
  const [ cardForms, setCardForms ] = React.useState<Array<CardForm>>([]);
  const [ secondaryCardForms, setSecondaryCardForms ] = React.useState<Array<CardForm>>([]);
  const [ stateFilters, setStateFilters ] = React.useState<Array<Option>>([]);
  const [ secondaryStateFilters, setSecondaryStateFilters ] = React.useState<Array<Option>>([]);
  const [ displayState, setDisplayState ] = React.useState<DisplayState>("simple" as any);
  const [ appliedSearchText, setAppliedSearch ] = React.useState(undefined);
  const [ showNotificationRecordsOnly, setShowNotificationRecordsOnly ] = React.useState(false);
  const [ error, setError ] = React.useState(undefined);

  const isFirstRun = React.useRef(true);

  if (error) {
    throw error;
  }

  const getConfigId = async () => {
    if (configState.configId) {
      return configState.configId;
    }

    const userId = formatGuid(Xrm.Page.context.getUserId());
    const user = await WebApiClient.Retrieve({ entityName: "systemuser", entityId: userId, queryParams: "?$select=oss_defaultboardid"});

    return user.oss_defaultboardid;
  };

  const initializeConfig = async () => {
    try {
      appDispatch({ type: "setSecondaryData", payload: [] });
      appDispatch({ type: "setBoardData", payload: [] });

      const configId = await getConfigId();

      if (!configId) {
        actionDispatch({ type: "setConfigSelectorDisplayState", payload: true });
        return;
      }

      actionDispatch({ type: "setProgressText", payload: "Fetching configuration" });
      const config = await fetchConfig(configId);

      if (config.customScriptUrl) {
        actionDispatch({ type: "setProgressText", payload: "Loading custom scripts" });
        await loadExternalScript(config.customScriptUrl);
      }

      actionDispatch({ type: "setProgressText", payload: "Fetching meta data" });

      const metadata = await fetchMetadata(config.primaryEntity.logicalName);
      const attributeMetadata = await fetchSeparatorMetadata(config.primaryEntity.logicalName, config.primaryEntity.swimLaneSource, metadata);
      const stateMetadata = await fetchSeparatorMetadata(config.primaryEntity.logicalName, "statecode", metadata);

      const notificationMetadata = await fetchMetadata("oss_notification");
      configDispatch({ type: "setSecondaryMetadata", payload: { entity: "oss_notification", data: notificationMetadata } });

      let secondaryMetadata: Metadata;
      let secondaryAttributeMetadata: Attribute;

      if (config.secondaryEntity) {
        secondaryMetadata = await fetchMetadata(config.secondaryEntity.logicalName);
        secondaryAttributeMetadata = await fetchSeparatorMetadata(config.secondaryEntity.logicalName, config.secondaryEntity.swimLaneSource, secondaryMetadata);

        configDispatch({ type: "setSecondaryMetadata", payload: { entity: config.secondaryEntity.logicalName, data: secondaryMetadata } });
        configDispatch({ type: "setSecondarySeparatorMetadata", payload: secondaryAttributeMetadata });
      }

      configDispatch({ type: "setConfig", payload: config });
      configDispatch({ type: "setMetadata", payload: metadata });
      configDispatch({ type: "setSeparatorMetadata", payload: attributeMetadata });
      configDispatch({ type: "setStateMetadata", payload: stateMetadata });
      actionDispatch({ type: "setProgressText", payload: "Fetching views" });

      const { value: views}: { value: Array<SavedQuery> } = await fetchViews(config.primaryEntity.logicalName);
      setViews(views.filter(v => 
        (!config.primaryEntity.hiddenViews || !config.primaryEntity.hiddenViews.some(h => v.name === h || v.savedqueryid === h))
        && (!config.primaryEntity.visibleViews || config.primaryEntity.visibleViews.some(h => v.name === h || v.savedqueryid === h))
      ));

      let defaultSecondaryView;
      if (config.secondaryEntity) {
        const { value: secondaryViews }: { value: Array<SavedQuery>} = await fetchViews(config.secondaryEntity.logicalName);
        setSecondaryViews(secondaryViews.filter(v => 
          (!config.secondaryEntity.hiddenViews || !config.secondaryEntity.hiddenViews.some(h => v.name === h || v.savedqueryid === h))
          && (!config.secondaryEntity.visibleViews || config.secondaryEntity.visibleViews.some(h => v.name === h || v.savedqueryid === h))
        ));

        defaultSecondaryView = config.secondaryEntity.defaultView
          ? secondaryViews.find(v => [v.savedqueryid, v.name].map(i => i.toLowerCase()).includes(config.secondaryEntity.defaultView.toLowerCase())) ?? secondaryViews[0]
          : secondaryViews[0];

        actionDispatch({ type: "setSelectedSecondaryView", payload: defaultSecondaryView });
      }

      const defaultView = config.primaryEntity.defaultView
          ? views.find(v => [v.savedqueryid, v.name].map(i => i.toLowerCase()).includes(config.primaryEntity.defaultView.toLowerCase())) ?? views[0]
          : views[0];

      actionDispatch({ type: "setSelectedView", payload: defaultView });
      actionDispatch({ type: "setProgressText", payload: "Fetching forms" });

      const { value: forms} = await fetchForms(config.primaryEntity.logicalName);
      const processedForms = forms.map((f: any) => ({ ...f, parsed: parseCardForm(f) }));
      setCardForms(processedForms);

      const { value: notificationForms } = await fetchForms("oss_notification");
      const processedNotificationForms = notificationForms.map((f: any) => ({ ...f, parsed: parseCardForm(f) }));
      configDispatch({ type: "setNotificationForm", payload: processedNotificationForms[0] });

      let defaultSecondaryForm;
      if (config.secondaryEntity) {
        const { value: forms} = await fetchForms(config.secondaryEntity.logicalName);
        const processedSecondaryForms = forms.map((f: any) => ({ ...f, parsed: parseCardForm(f) }));
        setSecondaryCardForms(processedSecondaryForms);

        defaultSecondaryForm = processedSecondaryForms[0];
        actionDispatch({ type: "setSelectedSecondaryForm", payload: defaultSecondaryForm });
      }

      const defaultForm = processedForms[0];

      if (!defaultForm) {
        actionDispatch({ type: "setProgressText", payload: undefined });
        return Xrm.Utility.alertDialog(`Did not find any card forms for ${config.primaryEntity.logicalName}, please create one.`, () => {});
      }

      actionDispatch({ type: "setSelectedForm", payload: defaultForm });

      actionDispatch({ type: "setProgressText", payload: "Fetching subscriptions" });
      const subscriptions = await fetchSubscriptions(config);
      appDispatch({ type: "setSubscriptions", payload: subscriptions });

      actionDispatch({ type: "setProgressText", payload: "Fetching notifications" });
      const notifications = await fetchNotifications(config);
      appDispatch({ type: "setNotifications", payload: notifications });

      actionDispatch({ type: "setProgressText", payload: "Fetching data" });

      const data = await fetchData(config.primaryEntity.logicalName, defaultView.fetchxml, config.primaryEntity.swimLaneSource, defaultForm, metadata, attributeMetadata, true, appState);

      if (config.secondaryEntity) {
        const secondaryData = await fetchData(config.secondaryEntity.logicalName,
          defaultSecondaryView.fetchxml,
          config.secondaryEntity.swimLaneSource,
          defaultSecondaryForm,
          secondaryMetadata,
          secondaryAttributeMetadata,
          false,
          appState,
          {
            additionalFields: [ config.secondaryEntity.parentLookup ],
            additionalCondition: {
              attribute: config.secondaryEntity.parentLookup,
              operator: "in",
              values: data.some(d => d.data.length > 1) ? data.reduce((all, d) => [...all, ...d.data.map(laneData => laneData[metadata.PrimaryIdAttribute] as string)], [] as Array<string>) : ["00000000-0000-0000-0000-000000000000"]
            }
          }
        );
        appDispatch({ type: "setSecondaryData", payload: secondaryData });
      }

      appDispatch({ type: "setBoardData", payload: data });
      actionDispatch({ type: "setProgressText", payload: undefined });
    }
    catch (e) {
      actionDispatch({ type: "setProgressText", payload: undefined });
      setError(e);
    }
  };

  // This is used for reinitializing when selected config changes
  React.useEffect(() => {
    setDisplayState("simple");
    initializeConfig();
  }, [ configState.configId ]);

  const setView = (event: React.FormEvent<HTMLDivElement>, item: IDropdownOption) => {
    const viewId = item.key;
    const view = views.find(v => v.savedqueryid === viewId);

    actionDispatch({ type: "setSelectedView", payload: view });
    refresh(appDispatch, appState, configState, actionDispatch, actionState, view.fetchxml);
  };

  const setForm = (event: React.FormEvent<HTMLDivElement>, item: IDropdownOption) => {
    const formId = item.key;
    const form = cardForms.find(f => f.formid === formId);

    actionDispatch({ type: "setSelectedForm", payload: form });
    refresh(appDispatch, appState, configState, actionDispatch, actionState, undefined, form);
  };

  const setDisplayType = (event: React.FormEvent<HTMLDivElement>, item: IDropdownOption) => {
    const displayType = item.key;
    
    if (displayType === "simple") {
      setSimpleDisplay();
    }
    else {
      setSecondaryDisplay();
    }
  };

  const setSecondaryView = (event: React.FormEvent<HTMLDivElement>, item: IDropdownOption) => {
    const viewId = item.key;
    const view = secondaryViews.find(v => v.savedqueryid === viewId);

    actionDispatch({ type: "setSelectedSecondaryView", payload: view });
    refresh(appDispatch, appState, configState, actionDispatch, actionState, undefined, undefined, view.fetchxml, undefined);
  };

  const setSecondaryForm = (event: React.FormEvent<HTMLDivElement>, item: IDropdownOption) => {
    const formId = item.key;
    const form = secondaryCardForms.find(f => f.formid === formId);

    actionDispatch({ type: "setSelectedSecondaryForm", payload: form });
    refresh(appDispatch, appState, configState, actionDispatch, actionState, undefined, undefined, undefined, form);
  };

  const setFilter = (item: IContextualMenuItem, attr: Attribute, setFilters: (value: React.SetStateAction<Array<Option>>) => void, filters: Array<Option>) => {
    const stateValue = item.key;

    if (filters.some(f => f.Value.toString() == stateValue)) {
      setFilters(filters.filter(f => f.Value.toString() != stateValue));
    }
    else {
      setFilters([...filters, attr.OptionSet.Options.find(o => o.Value.toString() == stateValue)]);
    }
  };

  const setStateFilter = (item: IContextualMenuItem, attr: Attribute) => {
    setFilter(item, attr, setStateFilters, stateFilters);
  };

  const setSecondaryStateFilter = (item: IContextualMenuItem, attr: Attribute) => {
    setFilter(item, attr, setSecondaryStateFilters, secondaryStateFilters);
  };

  const setSimpleDisplay = () => {
    setDisplayState("simple");
  };

  const setSecondaryDisplay = () => {
    setDisplayState("advanced");
  };

  const onSearch = (searchText?: string) => {
    setAppliedSearch(searchText || undefined);
  };

  const onEmptySearch = () => {
    setAppliedSearch(undefined);
  };

  const refreshBoard = async () => {
    await refresh(appDispatch, appState, configState, actionDispatch, actionState);
  };

  // Refresh board when external dataset refreshed
  React.useEffect(() => {
    if (isFirstRun.current) {
      isFirstRun.current = false;
      return;
    }
    
    if (!configState || !configState.config) {
      return;
    }

    refreshBoard();
  }, [ appState.primaryDataIds ]);

  const openConfigSelector = () => {
    actionDispatch({ type: "setConfigSelectorDisplayState", payload: true });
  };

  const advancedTileStyle = React.useMemo(() => ({ margin: "5px" as React.ReactText } as ICardStyles), []);
  
  const filterForSearchText = (d: BoardLane) => !appliedSearchText
    ? d
    : { ...d, data: d.data.filter(data => Object.keys(data).some(k => `${data[k]}`.toLowerCase().includes(appliedSearchText.toLowerCase()))) }

  const filterForNotifications = (d: BoardLane) => !showNotificationRecordsOnly 
    ? d 
    : { ...d, data: d.data.filter(data => appState.notifications && appState.notifications[data[configState.metadata.PrimaryIdAttribute]] && appState.notifications[data[configState.metadata.PrimaryIdAttribute]].length)};
  
  const filterLanes = (d: BoardLane, e: BoardEntity, filters: Array<Option>) => {
    const isStateVisible = !filters.length || filters.some(f => f.Value === d.option.Value);
    const isVisibleLane = !e.visibleLanes || e.visibleLanes.some(l => l === d.option.Value);
    const isHiddenLane = e.hiddenLanes?.some(l => l === d.option.Value);

    return isStateVisible && isVisibleLane && !isHiddenLane;
  };

  const filterPrimaryLanes = (d: BoardLane) => filterLanes(d, configState?.config.primaryEntity, stateFilters);
  const filterSecondaryLanes = (d: BoardLane) => filterLanes(d, configState?.config.secondaryEntity, secondaryStateFilters);

  const advancedData = React.useMemo(() => {
    return displayState === "advanced" && appState.boardData &&
    appState.boardData.filter(filterPrimaryLanes)
    .map(filterForSearchText)
    .map(filterForNotifications)
    .reduce((all, curr) => all.concat(curr.data.filter(d => appState.secondaryData.some(t => t.data.some(tt => tt[`_${configState.config.secondaryEntity.parentLookup}_value`] === d[configState.metadata.PrimaryIdAttribute])))
    .map(d => {
      const secondaryData = appState.secondaryData
        .filter(filterSecondaryLanes)
        .map(s => ({ ...s, data: s.data.filter(sd => sd[`_${configState.config.secondaryEntity.parentLookup}_value`] === d[configState.metadata.PrimaryIdAttribute])}));
      
      const secondarySubscriptions = Object.keys(appState.subscriptions)
      .filter(k => secondaryData.some(d => d.data.some(r => r[configState.secondaryMetadata[configState.config.secondaryEntity.logicalName].PrimaryIdAttribute] === k)))
      .reduce((all, cur) => ({ ...all, [cur]: appState.subscriptions[cur]}) , {});

      const secondaryNotifications = Object.keys(appState.notifications)
        .filter(k => secondaryData.some(d => d.data.some(r => r[configState.secondaryMetadata[configState.config.secondaryEntity.logicalName].PrimaryIdAttribute] === k)))
        .reduce((all, cur) => ({ ...all, [cur]: appState.notifications[cur]}) , {});

      return (<Tile
        notifications={!appState.notifications ? [] : appState.notifications[d[configState.metadata.PrimaryIdAttribute]] ?? []}
        borderColor={curr.option.Color ?? "#3b79b7"}
        cardForm={actionState.selectedForm}
        metadata={configState.metadata}
        key={`tile_${d[configState.metadata.PrimaryIdAttribute]}`}
        style={advancedTileStyle}
        data={d}
        refresh={refreshBoard}
        searchText={appliedSearchText}
        subscriptions={!appState.subscriptions ? [] : appState.subscriptions[d[configState.metadata.PrimaryIdAttribute]] ?? []}
        selectedSecondaryForm={actionState.selectedSecondaryForm}
        secondarySubscriptions={secondarySubscriptions}
        secondaryNotifications={secondaryNotifications}
        config={configState.config.primaryEntity}
        separatorMetadata={configState.separatorMetadata}
        preventDrag={true}
        secondaryData={secondaryData} />
      );
    })), []);
  }, [displayState, showNotificationRecordsOnly, appState.boardData, appState.secondaryData, stateFilters, secondaryStateFilters, appliedSearchText, appState.notifications, appState.subscriptions, actionState.selectedSecondaryForm, configState.configId]);

  const simpleData = React.useMemo(() => {
    return appState.boardData && appState.boardData
    .filter(filterPrimaryLanes)
    .map(filterForSearchText)
    .map(filterForNotifications)
    .map(d => <Lane
      notifications={appState.notifications}
      key={`lane_${d.option?.Value ?? "fallback"}`}
      cardForm={actionState.selectedForm}
      metadata={configState.metadata}
      refresh={refreshBoard}
      subscriptions={appState.subscriptions}
      searchText={appliedSearchText}
      config={configState.config.primaryEntity}
      separatorMetadata={configState.separatorMetadata}
      lane={{...d, data: d.data.filter(r => displayState === "simple" || appState.secondaryData && appState.secondaryData.every(t => t.data.every(tt => tt[`_${configState.config.secondaryEntity.parentLookup}_value`] !== r[configState.metadata.PrimaryIdAttribute])))}} />);
  }, [displayState, showNotificationRecordsOnly, appState.boardData, appState.subscriptions, stateFilters, appState.secondaryData, appliedSearchText, appState.notifications, configState.configId]);

  const currentNotifications = React.useMemo(() => {
    if (!configState.config) {
      return [[], []];
    }

    var primaryRecordIds = appState.boardData ? appState.boardData.reduce((all, cur) => [...all, ...cur.data], []).map(d => d[configState.metadata.PrimaryIdAttribute]) : [];
    var secondaryRecordIds = configState.config.secondaryEntity && appState.secondaryData
      ? appState.secondaryData.reduce((all, cur) => [...all, ...cur.data], []).map(d => d[configState.secondaryMetadata[configState.config.secondaryEntity.logicalName].PrimaryIdAttribute])
      : [];

    return [ primaryRecordIds.filter(id => appState.notifications && appState.notifications[id] && appState.notifications[id].length), secondaryRecordIds.filter(id => appState.notifications && appState.notifications[id] && appState.notifications[id].length) ];
  }, [ appState.boardData, appState.secondaryData, appState.notifications ]);

  const onRenderItem = (item: IOverflowSetItemProps): JSX.Element => {
    if (item.onRender) {
      return item.onRender(item);
    }
    return (
      <CommandBarButton
        role="menuitem"
        iconProps={{ iconName: item.icon }}
        menuProps={item.subMenuProps}
        text={item.name}
      />
    );
  };

  const dropdownStyles: Partial<IDropdownStyles> = {
    root: {
      margin: "5px",
    },
    dropdown: { width: 200 }
  };

  const navItemStyles: IButtonStyles = {
    root: {
      margin: "5px",
    },
  };

  const toggleShowNotificationRecordsOnly = () => {
    setShowNotificationRecordsOnly(!showNotificationRecordsOnly);
  };

  const renderStateFilter = (attr: Attribute, filters: Array<Option>, e: BoardEntity, onClick: (item: IContextualMenuItem, attr: Attribute) => void): IContextualMenuProps => {
    if (!attr || !e) {
      return undefined;
    }

    const options = attr.OptionSet.Options
      .filter(d => {
        if (!e.hiddenLanes && !e.visibleLanes) {
          return true;
        }
        
        const isVisibleLane = !e.visibleLanes || e.visibleLanes.some(l => l === d.Value);
        const isHiddenLane = e.hiddenLanes?.some(l => l === d.Value);

        return isVisibleLane && !isHiddenLane;
      });

    return {
      items: options.map(o => ({
        key: o.Value.toString(),
        canCheck: true,
        isChecked: filters.some(f => f.Value === o.Value),
        text: o.Label.UserLocalizedLabel.Label,
        onClick: (e, o) => onClick(o, attr) }))
    };
  };

  let primaryStateFilter = renderStateFilter(configState?.separatorMetadata, stateFilters, configState?.config?.primaryEntity, setStateFilter);
  let secondaryStateFilter = renderStateFilter(configState?.secondarySeparatorMetadata, secondaryStateFilters, configState?.config?.secondaryEntity, setSecondaryStateFilter);

  const navItems: Array<IOverflowSetItemProps> = [
    {
      key: 'configSelector',
      onRender: () => <IconButton iconProps={{ iconName: "Waffle" }} styles={navItemStyles} onClick={openConfigSelector}></IconButton>
    },
    {
      key: 'viewSelector',
      onRender: () => <Dropdown
        styles={dropdownStyles}
        id="viewSelector"
        onChange={setView}
        placeholder="Select view"
        selectedKey={actionState.selectedView?.savedqueryid}
        options={ views?.map(v => ({ key: v.savedqueryid, text: v.name})) }
      />,
    },
    {
      key: 'formSelector',
      onRender: () => <Dropdown
        styles={dropdownStyles}
        id="formSelector"
        onChange={setForm}
        placeholder="Select form"
        selectedKey={actionState.selectedForm?.formid}
        options={ cardForms?.map(f => ({ key: f.formid, text: f.name})) }
      />
    },
    (!configState.config || !configState.config.secondaryEntity
    ? null
    : {
      key: 'displaySelector',
      onRender: () => <Dropdown
        styles={navItemStyles}
        id="displaySelector"
        onChange={setDisplayType}
        selectedKey={displayState}
        options={ [ { key: "simple", text: "Simple"}, { key: "advanced", text: "Advanced"} ] }
      />
      }
    ),
    (displayState === "advanced"
    ? {
      key: 'secondaryViewSelector',
      onRender: () => <Dropdown
        styles={dropdownStyles}
        id="secondaryViewSelector"
        onChange={setSecondaryView}
        placeholder="Select view"
        selectedKey={actionState.selectedSecondaryView?.savedqueryid}
        options={secondaryViews?.map(v => ({ key: v.savedqueryid, text: v.name}))
        }
      />
      }
    : null
    ),
    (displayState === "advanced"
    ? {
      key: 'secondaryFormSelector',
      onRender: () => <Dropdown
        styles={navItemStyles}
        id="secondaryFormSelector"
        onChange={setSecondaryForm}
        placeholder="Select form"
        selectedKey={actionState.selectedSecondaryForm?.formid}
        options={ secondaryCardForms?.map(f => ({ key: f.formid, text: f.name})) }
      />
      }
    : null
    ),
    {
      key: 'primaryStatusFilter',
      onRender: () =>  <DefaultButton styles={navItemStyles} id="stateFilterSelector" text="Primary Lane Filter" menuProps={primaryStateFilter} />
    },
    (displayState !== "advanced"
    ? null
    : {
        key: 'secondaryStatusFilter',
        onRender: () =>  <DefaultButton styles={navItemStyles} id="secondaryStateFilterSelector" text="Secondary Lane Filter" menuProps={secondaryStateFilter} />
      }
    ),
    ( (configState.config?.primaryEntity.subscriptionLookup && configState.config?.primaryEntity.notificationLookup) || (configState.config?.secondaryEntity && configState.config?.secondaryEntity.subscriptionLookup && configState.config?.secondaryEntity.notificationLookup)
      ? {
        key: 'notificationIndicator',
        onRender: () =>  <IconButton onClick={toggleShowNotificationRecordsOnly} iconProps={{ iconName: showNotificationRecordsOnly ? "RingerSolid" : "Ringer", style: { color: (currentNotifications[0].length || currentNotifications[1].length) ? "red" : "inherit" } }} styles={navItemStyles}  />
      }
      : null
    ),
    {
      key: 'searchBox',
      onRender: () => <SearchBox styles={navItemStyles} placeholder="Search..." onClear={onEmptySearch} onSearch={onSearch} />
    },
    {
      key: 'workIndicator',
      onRender: () => !!actionState.workIndicator && <Spinner styles={{root: { marginLeft: "auto" }}} label="Working..." ariaLive="assertive" labelPosition="right" />
    }
  ];

  const onRenderOverflowButton = (overflowItems: any[] | undefined): JSX.Element => {
    const buttonStyles: Partial<IButtonStyles> = {
      root: {
        minWidth: 0,
        padding: '0 4px',
        alignSelf: 'stretch',
        height: 'auto',
      },
    };
    
    return (
      <CommandBarButton
        ariaLabel="More items"
        role="menuitem"
        styles={buttonStyles}
        menuIconProps={{ iconName: 'More' }}
        menuProps={{ items: overflowItems! }}
      />
    );
  };

  return (
    <div style={{height: "100%", display: "flex", flexDirection: "column" }}>
      <OverflowSet
        role="menubar"
        styles={{root: {backgroundColor: "#f8f9fa"}}}
        onRenderItem={onRenderItem}
        onRenderOverflowButton={onRenderOverflowButton}
        items={navItems.filter(i => !!i)}
      />
      <DndContainer>
        <div id="allInAll" style={{ display: "flex", flexDirection: "column", overflow: "auto" }}>
          { displayState === "advanced" &&
            <div id="advancedContainer" style={{ display: "flex", flexDirection: "column" }}>
              { advancedData }
            </div>
          }
          
          <div id="flexContainer" style={{ display: "flex", flexDirection: "row", flex: "1" }}>
            { simpleData }
          </div>
        </div>
      </DndContainer>
    </div>
  );
};
