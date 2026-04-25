namespace OpenHarvest.Domain.ValueObjects;

public record Vector3(double X, double Y, double Z)
{
    public static Vector3 Zero { get; } = new(0, 0, 0);
    public static Vector3 One { get; } = new(1, 1, 1);
}
