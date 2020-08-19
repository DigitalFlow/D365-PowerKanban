import * as React from "react";
import { Link } from "@fluentui/react/lib/Link";
import { CardCell } from "../domain/CardForm";
import { Metadata } from "../domain/Metadata";
import { RegexEscape } from "../domain/RegexEscape";
import * as htmlToText from "html-to-text";
import { Text } from "@fluentui/react/lib/Text";

interface FieldRowProps {
    cells: Array<CardCell>;
    data: any;
    type: "header" | "footer" | "body";
    metadata: Metadata;
    searchString?: string;
}

const FieldRowRender = (props: FieldRowProps) => {
    const openRecord = (event: any) => {
        const [entity, id] = event.target.id.split(".");
        Xrm.Navigation.openForm({ entityName: entity, entityId: id, openInNewWindow: true });
    };

    const toPlainText = (text: string): string => text != null && text.indexOf("<html>") !== -1 ? htmlToText.fromString(text) : text;

    const highlightSearch = (text: object) => {
        if (text == null) {
            return text;
        }

        const plainText = toPlainText(text.toString());

        const style: React.CSSProperties = props.type === "body"
            ? { wordBreak: "break-word", whiteSpace: "pre-wrap" }
            : { overflow: "hidden", textOverflow: "ellipsis" };

        if(!props.searchString) {
            return <Text style={style}>{ plainText }</Text>;
        }

        const substrings = plainText.split(new RegExp(`(${RegexEscape(props.searchString)})`, "gi"));
        return (<Text style={style}>
            {
                substrings.map((s, i) => (<Text key={i} style={s.toLowerCase() === props.searchString.toLowerCase() ? { backgroundColor: "yellow", ...style } : style}>{s}</Text>))
            }
        </Text>);
    };

    const getData = (fieldName: string): React.ReactNode => {
        const formattedValue = props.data[`${fieldName}@OData.Community.Display.V1.FormattedValue`];

        if (formattedValue) {
            return highlightSearch(formattedValue);
        }

        const lookupFormatted = props.data[`_${fieldName}_value@OData.Community.Display.V1.FormattedValue`];

        if (lookupFormatted) {
            const targetEntity = props.data[`_${fieldName}_value@Microsoft.Dynamics.CRM.lookuplogicalname`];
            return (<Link id={`${targetEntity}.${props.data[`_${fieldName}_value`]}`} onClick={openRecord}>{highlightSearch(lookupFormatted)}</Link>);
        }

        return highlightSearch(props.data[fieldName]);
    };

    // tslint:disable-next-line: no-null-keyword
    const rows: Array<[CardCell, React.ReactNode]> = props.cells.map(c => [c, getData(c.field)] as [CardCell, React.ReactNode]).filter(([c, data]) => data != null && data != "");

    if (props.type === "header") {
        return (
            <div style={{ display: "flex", flexDirection: "row" }}>
                { rows.map(([c, data], i) => <div title={props.metadata.Attributes.find(a => a.LogicalName === c.field)?.DisplayName.UserLocalizedLabel.Label} key={`cell_${props.data[props.metadata.PrimaryIdAttribute]}_${c.field}`} style={{marginLeft: i === 0 ? "0px" : "5px", marginRight: i === rows.length - 1 ? "0px" : "5px"}}>{ data }</div>) }
            </div>
        );
    }

    if (props.type === "footer") {
        return (
            <table style={{ width: "100%" }}>
                { rows.map(([c, data], i) => {
                    return (
                        <tr key={`cell_${props.data[props.metadata.PrimaryIdAttribute]}_${c.field}`}>
                            <td>
                                { data }
                            </td>
                            <td style={{textAlign: "right"}}>
                                <Text style={{color: "#666666"}}>{props.metadata.Attributes?.find(a => a.LogicalName === c.field).DisplayName.UserLocalizedLabel.Label}</Text>
                            </td>
                        </tr>);
                 })
                }
            </table>
        );
    }

    return (
        <div style={{ display: "flex", flexDirection: "column" }}>
            { rows.map(([c, data], i) => <div title={props.metadata.Attributes.find(a => a.LogicalName === c.field)?.DisplayName.UserLocalizedLabel.Label} key={`cell_${props.data[props.metadata.PrimaryIdAttribute]}_${c.field}`}>{ data }</div>) }
        </div>
    );
};

export const FieldRow = React.memo(FieldRowRender);