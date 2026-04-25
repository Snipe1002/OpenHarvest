namespace OpenHarvest.Domain.ValueObjects;

public record Transform(Vector3 Position, Quaternion Rotation, Vector3 Scale)
{
    public static Transform Identity { get; } =
        new(Vector3.Zero, Quaternion.Identity, Vector3.One);
}
