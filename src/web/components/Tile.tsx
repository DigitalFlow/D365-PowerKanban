import React, { useContext, useEffect, useState } from "react";
import { useAppContext } from "../domain/AppState";
import { Card } from "react-bootstrap";

interface TileProps {
    data: any;
}

export const Tile = (props: TileProps) => {
    const [ appState, appDispatch ] = useAppContext();

    const setSelectedRecord = () => {
        appDispatch({ type: "setSelectedRecord", payload: { entityType: appState.config.entityName, id: props.data[`${appState.config.entityName}id`] } });
    };

    return (
        <Card key={props.data[`${appState.config.entityName}id`]} onClick={setSelectedRecord}>
            <Card.Body>
                {props.data.createdon}
            </Card.Body>
        </Card>
    );
};