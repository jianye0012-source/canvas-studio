type StoppableNode = {
    id: string;
    metadata?: {
        status?: string;
        clientTaskId?: string;
        isBatchRoot?: boolean;
    };
};

type StoppableConnection = {
    fromNodeId: string;
    toNodeId: string;
};

export function configStoppableChildren(
    configId: string,
    nodes: StoppableNode[],
    connections: StoppableConnection[],
): string[] {
    const childIds = connections
        .filter((connection) => connection.fromNodeId === configId)
        .map((connection) => connection.toNodeId);
    const byId = new Map(nodes.map((node) => [node.id, node]));
    return childIds.filter((childId) => {
        const node = byId.get(childId);
        if (!node) return false;
        const status = node.metadata?.status;
        return (status === "loading" || status === "stopping") && Boolean(node.metadata?.clientTaskId) && !node.metadata?.isBatchRoot;
    });
}
