namespace PlcWiringTrainer.Core.Validation;

/// <summary>단자와 내부 링크가 형성하는 결정적 도통 그룹을 계산합니다.</summary>
internal sealed class DisjointSet
{
    private readonly Dictionary<string, string> _parent = new(StringComparer.Ordinal);

    public void Add(string item)
    {
        if (!_parent.ContainsKey(item))
        {
            _parent[item] = item;
        }
    }

    public void Union(string left, string right)
    {
        Add(left);
        Add(right);
        string leftRoot = Find(left);
        string rightRoot = Find(right);
        if (!string.Equals(leftRoot, rightRoot, StringComparison.Ordinal))
        {
            _parent[rightRoot] = leftRoot;
        }
    }

    public bool AreConnected(string left, string right)
        => _parent.ContainsKey(left)
            && _parent.ContainsKey(right)
            && string.Equals(Find(left), Find(right), StringComparison.Ordinal);

    public string GroupId(string member)
        => _parent.ContainsKey(member) ? Find(member) : string.Empty;

    public Dictionary<string, string[]> SnapshotGroups()
        => _parent.Keys
            .GroupBy(Find, StringComparer.Ordinal)
            .ToDictionary(
                group => group.Key,
                group => group.OrderBy(item => item, StringComparer.Ordinal).ToArray(),
                StringComparer.Ordinal);

    private string Find(string item)
    {
        string parent = _parent[item];
        if (!string.Equals(parent, item, StringComparison.Ordinal))
        {
            _parent[item] = Find(parent);
        }

        return _parent[item];
    }
}
